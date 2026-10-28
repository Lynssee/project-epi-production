// src/routes/api/surat-jalan/servis-luar/+server.ts
// Fase 6 (Rencana Implementasi v2.0 — Pergerakan External Terpadu): sisi lapangan
// dari dispatch bengkel yang dibangun di erp-epi-1 (maintenanceSjApi.js).
//
// GET  ?code=<qr_token>  -> resolve QR fisik SJ menjadi detail dispatch untuk /scan/[code].
// POST                   -> mekanik konfirmasi retur equipment dari bengkel (D4: mekanik scan
//                           di lapangan; verifikasi admin di dashboard dipakai fields
//                           gr_verified_by/gr_verified_at yang sudah ada, belum ada tombolnya
//                           di admin — lihat catatan di memory project).
//
// Sengaja TIDAK memakai /api/goods-received/confirm (endpoint itu untuk GR proyek berbasis
// RAB/project_expenses dengan reklas HPP & jurnal — semua tidak relevan untuk equipment
// servis luar yang K4 tetapkan cukup ganti status, bukan potong stok/reklas biaya).

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { directusServerJson } from '$lib/server/directus';

// Gate Bengkel / Jasa Eksternal — Fase 6 (29 Agu 2026): kalau WO ini punya Perjanjian
// Kerja (service_agreement) berjalan, tarik item scope-nya supaya mekanik bisa
// mencentang "sesuai/tidak dikerjakan/bermasalah" saat retur -- mengisi
// service_agreement_item.hasil_retur, yang jadi input K6 scorecard vendor & settlement.
// Tidak wajib ada (WO servis luar yang SA-nya belum dibuat tetap bisa retur seperti biasa).
async function loadScopeItems(workOrderId: string | null) {
	if (!workOrderId) return { serviceAgreementId: null, scopeItems: [] };
	const saRes = await directusServerJson<{ data: any[] }>(
		`/items/service_agreement?filter[work_order_id][_eq]=${workOrderId}` +
		`&filter[status][_in]=approved,in_progress,completed&fields=id&sort=-date_created&limit=1`
	).catch(() => null);
	const saId = saRes?.data?.[0]?.id;
	if (!saId) return { serviceAgreementId: null, scopeItems: [] };

	const itemsRes = await directusServerJson<{ data: any[] }>(
		`/items/service_agreement_item?filter[service_agreement_id][_eq]=${saId}&filter[tipe][_eq]=scope&fields=id,deskripsi,hasil_retur&limit=-1`
	).catch(() => null);
	return {
		serviceAgreementId: saId,
		scopeItems: (itemsRes?.data || []).map((it) => ({ id: it.id, deskripsi: it.deskripsi, hasil_retur: it.hasil_retur }))
	};
}

async function loadDispatch(suratJalanId: number) {
	const sj = (
		await directusServerJson<{ data: any }>(
			`/items/surat_jalan/${suratJalanId}?fields=id,nomor_sj,status,return_status,source_type,work_order_id,bengkel_id`
		).catch(() => null)
	)?.data;
	if (!sj || sj.source_type !== 'maintenance') return null;

	const [itemsRes, bengkelRes, scope] = await Promise.all([
		directusServerJson<{ data: any[] }>(
			`/items/surat_jalan_items?filter[surat_jalan_id][_eq]=${suratJalanId}&fields=id,equipment_id,nama_barang,kondisi_berangkat&limit=-1`
		),
		sj.bengkel_id
			? directusServerJson<{ data: any }>(`/items/contact/${sj.bengkel_id}?fields=id,name`).catch(() => null)
			: Promise.resolve(null),
		loadScopeItems(sj.work_order_id)
	]);

	return {
		id: sj.id,
		nomor_sj: sj.nomor_sj,
		status: sj.status,
		return_status: sj.return_status,
		work_order_id: sj.work_order_id,
		bengkel_name: bengkelRes?.data?.name || '-',
		items: (itemsRes?.data || []).map((it) => ({
			id: it.id,
			equipment_id: it.equipment_id,
			nama_barang: it.nama_barang,
			kondisi_berangkat: it.kondisi_berangkat
		})),
		serviceAgreementId: scope.serviceAgreementId,
		scopeItems: scope.scopeItems
	};
}

export const GET: RequestHandler = async (event) => {
	await requireUser(event);

	const code = event.url.searchParams.get('code');
	if (!code) throw error(400, 'Parameter code wajib diisi.');

	const sjRes = await directusServerJson<{ data: any[] }>(
		`/items/surat_jalan?filter[qr_token][_eq]=${encodeURIComponent(code)}&filter[source_type][_eq]=maintenance&fields=id&limit=1`
	).catch(() => null);
	const suratJalanId = sjRes?.data?.[0]?.id;
	if (!suratJalanId) throw error(404, 'QR tidak dikenali sebagai Surat Jalan servis luar.');

	const dispatch = await loadDispatch(suratJalanId);
	if (!dispatch) throw error(404, 'Surat Jalan tidak ditemukan.');

	return json(dispatch);
};

interface ConfirmItem {
	surat_jalan_item_id: number;
	kondisi_kembali: 'baik' | 'rusak' | 'hilang';
}

interface ScopeResult {
	itemId: string;
	hasilRetur: 'sesuai' | 'tidak_dikerjakan' | 'bermasalah';
}

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawanByEmail(user.email);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	const body = await event.request.json().catch(() => null);
	const suratJalanId = Number(body?.suratJalanId);
	const items: ConfirmItem[] = Array.isArray(body?.items) ? body.items : [];
	const fotoTerimaFileId: string | null = body?.fotoTerimaFileId || null;
	const gps: { lat?: number; lng?: number; accuracy?: number } | null = body?.gps || null;
	const scopeResults: ScopeResult[] = Array.isArray(body?.scopeResults) ? body.scopeResults : [];

	if (!Number.isFinite(suratJalanId)) throw error(400, 'suratJalanId tidak valid.');
	if (items.length === 0) throw error(400, 'Tidak ada item untuk dikonfirmasi.');
	if (!fotoTerimaFileId) throw error(400, 'Foto bukti serah-terima wajib diunggah.');

	const dispatch = await loadDispatch(suratJalanId);
	if (!dispatch) throw error(404, 'Surat Jalan servis luar tidak ditemukan.');
	if (dispatch.status === 'received' || dispatch.status === 'closed') {
		throw error(409, `Surat Jalan ${dispatch.nomor_sj} sudah dikonfirmasi diterima sebelumnya.`);
	}

	const dispatchItemIds = new Set(dispatch.items.map((it) => it.id));
	for (const it of items) {
		if (!dispatchItemIds.has(it.surat_jalan_item_id)) {
			throw error(400, `Item ${it.surat_jalan_item_id} bukan bagian dari Surat Jalan ini.`);
		}
	}

	for (const it of items) {
		await directusServerJson(`/items/surat_jalan_items/${it.surat_jalan_item_id}`, {
			method: 'PATCH',
			body: JSON.stringify({ qty_gr_received: 1, gr_condition: it.kondisi_kembali })
		});

		const dispatchItem = dispatch.items.find((di) => di.id === it.surat_jalan_item_id);
		if (dispatchItem?.equipment_id) {
			const statusOperational = it.kondisi_kembali === 'baik' ? 'available' : 'broken';
			await directusServerJson(`/items/equipment/${dispatchItem.equipment_id}`, {
				method: 'PATCH',
				body: JSON.stringify({ status_operational: statusOperational })
			}).catch(() => {});
		}
	}

	// Fase 7: delivery_variance dipakai oleh workflow n8n "GR - Alert Deviasi ke Manajer
	// Logistik & Finance" yang sudah ada (query generik status=received AND delivery_variance=true,
	// tidak dibatasi source_type) — menandainya di sini otomatis membuat retur servis luar
	// bermasalah ikut ter-alert tanpa perlu cabang workflow baru.
	const hasVariance = items.some((it) => it.kondisi_kembali !== 'baik');

	// Gate Bengkel Fase 6: checklist retur berbasis item SA -- tulis hasil_retur per
	// item scope. Validasi item id benar-benar milik SA WO ini (jangan percaya body klien).
	if (scopeResults.length > 0) {
		const scopeItemIds = new Set(dispatch.scopeItems.map((it: any) => it.id));
		for (const sr of scopeResults) {
			if (!scopeItemIds.has(sr.itemId)) {
				throw error(400, `Item scope ${sr.itemId} bukan bagian dari Perjanjian Kerja WO ini.`);
			}
		}
		for (const sr of scopeResults) {
			await directusServerJson(`/items/service_agreement_item/${sr.itemId}`, {
				method: 'PATCH',
				body: JSON.stringify({ hasil_retur: sr.hasilRetur })
			}).catch(() => {});
		}
	}

	// Semua item dikonfirmasi dalam satu kali submit (tidak ada retur sebagian di v1).
	await directusServerJson(`/items/surat_jalan/${suratJalanId}`, {
		method: 'PATCH',
		body: JSON.stringify({
			status: 'received',
			return_status: 'selesai',
			received_at: new Date().toISOString(),
			received_by: karyawan.nama_karyawan,
			foto_terima: fotoTerimaFileId,
			confirmed_by: karyawan.nama_karyawan,
			delivery_variance: hasVariance,
			gr_gps_lat: gps?.lat ?? null,
			gr_gps_lng: gps?.lng ?? null,
			gr_gps_accuracy: gps?.accuracy ?? null
		})
	});

	return json({ success: true });
};
