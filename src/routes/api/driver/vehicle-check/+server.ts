import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateDriver } from '$lib/server/driver/driverGuard';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';

// Sama persis dengan constants di src/lib/services/preventive.ts (P2H_WO_IDS) — id kategori
// work_order ini berasal dari Directus bersama, jangan diubah tanpa menyamakan di sana juga.
const WO_IDS = {
	DARURAT: 'c8006ed8-b434-402f-9fb0-97c2f5284a42',
	MINOR: '5e393139-0ff7-426a-8673-3af319161663',
	CORRECTIVE: '561ad0b7-c246-4c24-bb66-5cc7e123fbda',
	STATUS_OPEN: '0e119df1-b7e5-44c1-ace4-d14c5a99c10b'
};

interface CheckItem {
	// ESS Redesign: template P2H config-driven pakai key/label; nama lama tetap didukung.
	key?: string;
	label?: string;
	name?: string;
	status: 'ok' | 'rusak' | 'tidak_ada';
	kritis?: boolean;
}

const itemLabel = (i: CheckItem) => i.label || i.name || i.key || 'Item';

export const POST: RequestHandler = async (event) => {
	const { driver } = await authenticateDriver(event);

	const form = await event.request.formData().catch(() => null);
	if (!form) throw error(400, 'Form data tidak valid.');

	const vehicleId = String(form.get('vehicle_id') || '');
	const temuan = String(form.get('temuan') || '').trim();
	const bookingId = form.get('booking_id') ? String(form.get('booking_id')) : null;
	const kmSaatCek = form.get('km_saat_cek') != null ? Number(form.get('km_saat_cek')) : null;
	const foto = form.get('foto'); // File
	let items: CheckItem[] = [];
	try {
		items = JSON.parse(String(form.get('items') || '[]'));
	} catch {
		throw error(400, 'Data checklist tidak valid.');
	}

	if (!vehicleId) throw error(400, 'Kendaraan wajib dipilih.');
	if (!Array.isArray(items) || items.length === 0) throw error(400, 'Checklist tidak boleh kosong.');

	const today = todayJakarta();

	// Cegah driver mengisi P2H dua kali untuk kendaraan yang sama di hari yang sama.
	const existingQuery = new URLSearchParams({
		'filter[vehicle_id][_eq]': vehicleId,
		'filter[tanggal][_eq]': today,
		limit: '1'
	});
	const existing = await directusServerJson<{ data: any[] }>(`/items/fleet_vehicle_check?${existingQuery.toString()}`);
	if (existing?.data?.length) throw error(409, 'Cek kendaraan untuk hari ini sudah tercatat.');

	let fotoId: string | null = null;
	if (foto instanceof File && foto.size > 0) {
		const uploadForm = new FormData();
		uploadForm.append('file', foto);
		const res = await directusServerUpload(uploadForm);
		if (!res.ok) throw error(502, 'Gagal mengunggah foto temuan.');
		const uploaded = await res.json();
		fotoId = uploaded?.data?.id ?? null;
	}

	// ESS Redesign — template P2H 3-status: 'rusak' & 'tidak_ada' sama-sama = tidak laik / picu WO.
	const rusakItems = items.filter((i) => i.status && i.status !== 'ok');
	const status = rusakItems.length > 0 ? 'tidak_laik' : 'laik';

	const check = await directusServerJson<{ data: any }>('/items/fleet_vehicle_check', {
		method: 'POST',
		body: JSON.stringify({
			vehicle_id: vehicleId,
			driver_id: driver.id,
			tanggal: today,
			items,
			km_saat_cek: kmSaatCek,
			temuan: temuan || null,
			foto: fotoId,
			status,
			booking_id: bookingId,
			sumber: 'p2h_driver'
		})
	});
	const checkId = check?.data?.id;

	let workOrder: any = null;
	if (rusakItems.length > 0) {
		const criticalRusak = rusakItems.filter((i) => i.kritis);
		const keluhan = rusakItems
			.map((i) => `${i.kritis ? '[KRITIS] ' : ''}${itemLabel(i)}${i.status === 'tidak_ada' ? ' (tidak ada)' : ''}`)
			.join('\n');

		// work_order.equipment_id adalah FK ke collection equipment, bukan fleet_kendaraan.
		// Sejak Fase 0 Fleet v2, vehicle_id di sini adalah id fleet_kendaraan — perlu di-resolve
		// ke padanan equipment (legacy_equipment_id) supaya WO tetap tertaut aset yang benar.
		const kendaraanRes = await directusServerJson<{ data: any[] }>(
			`/items/fleet_kendaraan?filter[id][_eq]=${encodeURIComponent(vehicleId)}&fields=id,legacy_equipment_id,nomor_polisi,merk,model&limit=1`
		);
		const kendaraan = kendaraanRes?.data?.[0];
		const equipmentId = kendaraan?.legacy_equipment_id || null;
		if (!equipmentId) {
			throw error(500, 'Kendaraan ini belum tertaut ke aset equipment (legacy_equipment_id kosong). Hubungi admin Fleet sebelum P2H bisa membuat Work Order.');
		}
		const vehicleLabel = kendaraan ? [kendaraan.merk, kendaraan.model].filter(Boolean).join(' ') || kendaraan.nomor_polisi : vehicleId;

		workOrder = await directusServerJson<{ data: any }>('/items/work_order', {
			method: 'POST',
			body: JSON.stringify({
				equipment_id: equipmentId,
				keluhan: temuan ? `${keluhan}\n\nCatatan driver: ${temuan}` : keluhan,
				kategori_perbaikan_id: criticalRusak.length > 0 ? WO_IDS.DARURAT : WO_IDS.MINOR,
				jenis_pekerjaan_id: WO_IDS.CORRECTIVE,
				order_status: WO_IDS.STATUS_OPEN,
				tanggal_rusak: today,
				is_quick_create: true,
				foto_awal: fotoId,
				alasan_pengajuan: `Auto Cek Kendaraan (P2H Driver App, ${vehicleLabel}) — item bermasalah: ${rusakItems.map((i) => itemLabel(i)).join(', ')}`
			})
		});

		if (workOrder?.data?.id) {
			await directusServerJson(`/items/fleet_vehicle_check/${checkId}`, {
				method: 'PATCH',
				body: JSON.stringify({ maint_ticket_id: workOrder.data.id })
			});
		}
	}

	return json({ record: check?.data ?? check, work_order: workOrder?.data ?? null });
};
