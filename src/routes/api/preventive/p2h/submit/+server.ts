// src/routes/api/preventive/p2h/submit/+server.ts
// Fase 1 (PM Compressor & Sanksi Berjenjang) — perbaikan B1/B8: submit P2H diproses
// SATU request server-side (session + item log + auto-WO), bukan beberapa request
// klien terpisah seperti submitP2hSession() lama di preventive.ts. Kalau sinyal putus
// di tengah jalan sekarang, itu putus di jaringan server->Directus (stabil), bukan
// di jaringan HP->server (lemah) — dan kalau logging item gagal setelah sesi terbuat,
// sesi yang orphan dihapus lagi (bukan dibiarkan "P2H hari ini sudah diisi" palsu).
// Guard idempotensi server-side (B8): sesi utk equipment+tanggal yang sama ditolak 409,
// tidak hanya dicegah di klien.
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticatePreventiveOperator } from '$lib/server/preventive/preventiveGuard';
import { directusServerJson } from '$lib/server/directus';
import { getMleSettingServer } from '$lib/server/mleSettings';
import { notifyProjectP2hSubmitted } from '$lib/server/projectNotify';

const P2H_WO_IDS = {
	DARURAT: 'c8006ed8-b434-402f-9fb0-97c2f5284a42',
	MINOR: '5e393139-0ff7-426a-8673-3af319161663',
	CORRECTIVE: '561ad0b7-c246-4c24-bb66-5cc7e123fbda',
	STATUS_OPEN: '0e119df1-b7e5-44c1-ace4-d14c5a99c10b'
};

let resultCategoriesCache: { goId: string; noGoId: string } | null = null;
async function getResultCategories() {
	if (resultCategoriesCache) return resultCategoriesCache;
	const cats = await directusServerJson<{ data: any[] }>(
		`/items/category?${new URLSearchParams({ 'filter[group][_eq]': 'p2h_result', limit: '-1' }).toString()}`
	);
	const go = cats.data.find((c) => c.name === 'Go');
	const noGo = cats.data.find((c) => c.name === 'No-Go');
	if (!go || !noGo) throw error(500, 'Kategori hasil P2H (Go/No-Go) tidak ditemukan di Directus.');
	resultCategoriesCache = { goId: go.id, noGoId: noGo.id };
	return resultCategoriesCache;
}

interface ChecklistItemInput {
	template_id: string;
	item_name: string;
	is_critical: boolean;
	wajib_foto?: boolean | number | null;
	nogo_criteria?: string | null;
	action_if_nogo_operator?: string | null;
	action_if_nogo_mekanik?: string | null;
	result: 'Go' | 'No-Go';
	notes?: string;
	foto?: string | null;
	numeric_value?: number | null;
	text_value?: string | null;
}

export const POST: RequestHandler = async (event) => {
	const { personnel } = await authenticatePreventiveOperator(event);

	const body = await event.request.json().catch(() => null);
	const equipmentId = body?.equipment_id ? String(body.equipment_id) : '';
	const date = body?.date ? String(body.date) : '';
	const keteranganTambahan = body?.keterangan_tambahan ? String(body.keterangan_tambahan).trim() : null;
	const fotoUnit = body?.foto_unit ? String(body.foto_unit) : null;
	const gpsLat = typeof body?.gps_lat === 'number' ? body.gps_lat : null;
	const gpsLng = typeof body?.gps_lng === 'number' ? body.gps_lng : null;
	const scanMethod = body?.scan_method === 'manual' ? 'manual' : 'scan';
	const hoursmeter = typeof body?.hoursmeter === 'number' ? body.hoursmeter : null;
	const signature = body?.signature ? String(body.signature).trim() : '';
	const checklistItems: ChecklistItemInput[] = Array.isArray(body?.checklist_items) ? body.checklist_items : [];

	if (!equipmentId) throw error(400, 'equipment_id wajib diisi.');
	if (!date) throw error(400, 'date wajib diisi.');
	if (!signature) throw error(400, 'Tanda tangan wajib diisi.');
	if (!checklistItems.length) throw error(400, 'checklist_items tidak boleh kosong.');

	// Validate Photo Requirement per item before proceeding
	for (const item of checklistItems) {
		if (item.wajib_foto && !item.foto) {
			throw error(400, `Foto bukti wajib dilampirkan untuk item: ${item.item_name}`);
		}
	}

	// Guard idempotensi server-side (B8) — bukan hanya klien yang bilang "sudah diisi".
	const existingQuery = new URLSearchParams({
		'filter[equipment_id][_eq]': equipmentId,
		'filter[date][_eq]': date,
		limit: '1'
	});
	const existing = await directusServerJson<{ data: any[] }>(`/items/p2h_session?${existingQuery.toString()}`);
	if (existing?.data?.length) {
		throw error(409, 'P2H untuk unit dan tanggal ini sudah tercatat.');
	}

	const { goId, noGoId } = await getResultCategories();
	const hasNoGo = checklistItems.some((i) => i.result === 'No-Go');

	const sessionRes = await directusServerJson<{ data: any }>('/items/p2h_session', {
		method: 'POST',
		body: JSON.stringify({
			equipment_id: equipmentId,
			date,
			operator_id: personnel.id,
			overall_result: hasNoGo ? noGoId : goId,
			keterangan_tambahan: keteranganTambahan,
			foto_unit: fotoUnit,
			gps_lat: gpsLat,
			gps_lng: gpsLng,
			scan_method: scanMethod,
			hoursmeter,
			signature
		})
	});
	const session = sessionRes.data;

	try {
		for (const item of checklistItems) {
			await directusServerJson('/items/p2h_log', {
				method: 'POST',
				body: JSON.stringify({
					p2h_session_id: session.id,
					p2h_template_id: item.template_id,
					equipment_id: equipmentId,
					result: item.result === 'Go' ? goId : noGoId,
					notes: item.notes || '',
					photo: item.foto || null,
					numeric_value: item.numeric_value ?? null,
					text_value: item.text_value ?? null
				})
			});
		}

		const noGoItems = checklistItems.filter((i) => i.result === 'No-Go');
		const criticalNoGo = noGoItems.filter((i) => i.is_critical);
		const mechanicNoGo = noGoItems.filter((i) => !i.is_critical && i.action_if_nogo_mekanik);

		// Fase 3 MLE (10 Agu 2026, "Lapangan" round): toggle mle.equipment.p2h_auto_wo dari
		// Panel Setelan admin (/settings/material-logistik-equipment). Default true = perilaku
		// lama (auto-create WO). Kalau dimatikan, status_operational tetap di-interlock ke
		// 'breakdown' untuk item kritis (itu penguncian keselamatan, bukan kenyamanan) —
		// yang digate cuma pembuatan work_order-nya.
		const autoWoEnabled = await getMleSettingServer('mle.equipment.p2h_auto_wo', true);

		let workOrder: any = null;
		if (criticalNoGo.length > 0) {
			// Interlock keselamatan: SELALU jalan, tidak digate toggle p2h_auto_wo.
			await directusServerJson(`/items/equipment/${equipmentId}`, {
				method: 'PATCH',
				body: JSON.stringify({ status_operational: 'breakdown' })
			}).catch(() => {});

			if (autoWoEnabled) {
				const keluhan = criticalNoGo
					.map((i) => `[KRITIS] ${i.item_name}: ${i.nogo_criteria || ''}${i.notes ? ' — ' + i.notes : ''}`)
					.join('\n');
				const woRes = await directusServerJson<{ data: any }>('/items/work_order', {
					method: 'POST',
					body: JSON.stringify({
						equipment_id: equipmentId,
						keluhan,
						kategori_perbaikan_id: P2H_WO_IDS.DARURAT,
						jenis_pekerjaan_id: P2H_WO_IDS.CORRECTIVE,
						order_status: P2H_WO_IDS.STATUS_OPEN,
						tanggal_rusak: date,
						is_quick_create: true,
						alasan_pengajuan: `Auto P2H — item kritis No-Go: ${criticalNoGo.map((i) => i.item_name).join(', ')}`
					})
				});
				workOrder = woRes.data;
			}
		} else if (mechanicNoGo.length > 0 && autoWoEnabled) {
			const keluhan = mechanicNoGo
				.map((i) => `${i.item_name}: ${i.nogo_criteria || ''}${i.notes ? ' — ' + i.notes : ''}`)
				.join('\n');
			const woRes = await directusServerJson<{ data: any }>('/items/work_order', {
				method: 'POST',
				body: JSON.stringify({
					equipment_id: equipmentId,
					keluhan,
					kategori_perbaikan_id: P2H_WO_IDS.MINOR,
					jenis_pekerjaan_id: P2H_WO_IDS.CORRECTIVE,
					order_status: P2H_WO_IDS.STATUS_OPEN,
					tanggal_rusak: date,
					is_quick_create: true,
					alasan_pengajuan: 'Auto P2H — perlu penanganan mekanik'
				})
			});
			workOrder = woRes.data;
		}

		if (workOrder) {
			await directusServerJson(`/items/p2h_session/${session.id}`, {
				method: 'PATCH',
				body: JSON.stringify({ work_order_id: workOrder.id })
			});
		}

		if (hoursmeter != null) {
			await directusServerJson(`/items/equipment/${equipmentId}`, {
				method: 'PATCH',
				body: JSON.stringify({ last_hoursmeter: hoursmeter })
			});
		}

		await notifyProjectP2hSubmitted(session.id, `unit ${equipmentId}`, personnel.id, criticalNoGo.length);

		return json({ session, workOrder });
	} catch (err) {
		// Gagal di tengah (item log / WO) — hapus sesi orphan supaya operator tidak
		// diblokir "P2H hari ini sudah diisi" atas data yang sebenarnya tidak lengkap.
		await directusServerJson(`/items/p2h_session/${session.id}`, { method: 'DELETE' }).catch(() => {});
		throw error(500, err instanceof Error ? err.message : 'Gagal menyimpan ceklist P2H.');
	}
};
