// src/lib/services/paintOrderStatus.ts
// Fase 6 (Lapangan) — Kartu "Pesanan Saya": Sales/leader buka HP untuk satu pertanyaan,
// "sudah sampai mana pesanan saya?" Sumber kebenaran linkage: so_customer.karyawan_id
// (BUKAN sales_name teks bebas — lihat catatan field itu di Directus). paint_order dan
// stage-derivation-nya dibangun di erp-epi-1 (Fase 0/4); di sini versi ringan read-only,
// karena repo project-epi terpisah dan tidak bisa impor langsung dari erp-epi-1.

import { get } from 'svelte/store';
import { authStore } from '$lib/stores/auth';
import { secureDirectusJson } from './secureDirectus';

export interface MyPaintOrder {
	id: number;
	kode: string;
	so_nomor: string | null;
	customer_name: string | null;
	target_kirim: string | null;
	stage_label: string;
	is_selesai: boolean;
	/** Fase 6.2 (rencana lifecycle produksi v2, 15 Sep 2026): ada/pernah ada batch rework di order ini. */
	has_rework_batch: boolean;
}

// Fase 6.2: rework_completed (SPK asal ditutup setelah rework-nya sukses) & rejected
// (batch gagal/scrap, lihat Antrean Disposisi QA erp-epi) sebelumnya TIDAK ADA di peta ini —
// leader proyek melihat status mentah "rework_completed"/"rejected" alih-alih label yang jelas.
const STAGE_LABELS: Record<string, string> = {
	requested: 'Menunggu Formula/SPK',
	worksheet_generated: 'SPK Terbit',
	waiting_for_stock: 'Menunggu Stok Bahan',
	in_progress: 'Produksi Berjalan',
	qc_pending: 'Menunggu Hasil QC',
	qc_start: 'Menunggu Hasil QC',
	rework_required: 'Gagal QC — Rework',
	rework_completed: 'Selesai Produksi (via Rework)',
	rejected: 'Ditolak / Scrap',
	hold: 'Ditahan Sementara',
	completed: 'Selesai Produksi',
	cancelled: 'Dibatalkan'
};

// Fase 6 (Sumber SPK Terpusat, 17 Sep 2026): tahapan proyek menambah "Menunggu Analisa
// R&D" di antara QC dan Selesai — beda dari stage generik di atas (dipakai kartu "Pesanan
// Saya" berbasis SO/paint_order). SPK proyek diidentifikasi lewat request_ref = nomor_pl
// (diisi otomatis sejak Fase 0 erp-epi, createSPKRequestsFromShortage origin
// inventory_pl_shortage) — BUKAN tabel paint_order (proyek tidak melalui itu).
const PROJECT_STAGE_LABELS: Record<string, string> = {
	...STAGE_LABELS,
	rework_required: 'Gagal QC — Rework',
	menunggu_analisa_rnd: 'Menunggu Analisa R&D'
};

export interface ProjectSpkStatus {
	id: number;
	nomor: string;
	product_name: string | null;
	quantity: number | null;
	unit: string | null;
	request_ref: string | null;
	stage_key: string;
	stage_label: string;
	is_selesai: boolean;
	tanggal: string | null;
}

/**
 * Fase 6 (Lapangan project-epi) — daftar SPK read-only untuk SATU proyek, dipakai tab
 * "Status Permintaan" di /proyek/[project_id] (dulu placeholder "tersedia di Admin ERP").
 * Lapangan TIDAK membuat SPK di sini — murni observasional, tetap lewat PL → Gudang.
 * 3 query terpisah (Aturan #2 Anti-403: relasi dipisah, bukan nested expansion):
 *   1) packing_list milik proyek -> daftar nomor_pl
 *   2) spk dengan request_ref masuk daftar nomor_pl itu
 *   3) production_rework utk SPK berstatus rework_required, cek rnd_reviewed_at
 */
export async function getProjectSpkStatus(projectId: number): Promise<ProjectSpkStatus[]> {
	if (!projectId) return [];

	const plRes = await secureDirectusJson<{ data: any[] }>(
		`/items/packing_list?filter[project_id][_eq]=${projectId}&fields=id,nomor_pl&limit=-1`
	).catch(() => ({ data: [] }));
	const nomorPlList = (plRes?.data || []).map((r) => r.nomor_pl).filter(Boolean);
	if (nomorPlList.length === 0) return [];

	const spkRes = await secureDirectusJson<{ data: any[] }>(
		`/items/spk?filter[request_ref][_in]=${nomorPlList.map(encodeURIComponent).join(',')}` +
			`&fields=id,nomor,status,quantity,unit,request_ref,tanggal,product_id.nama_barang_lengkap` +
			`&sort=-tanggal&limit=-1`
	).catch(() => ({ data: [] }));
	const spkRows = spkRes?.data || [];
	if (spkRows.length === 0) return [];

	const reworkRequiredIds = spkRows.filter((r) => r.status === 'rework_required').map((r) => r.id);
	let unreviewedSpkIds = new Set<number>();
	if (reworkRequiredIds.length > 0) {
		const ncrRes = await secureDirectusJson<{ data: any[] }>(
			`/items/production_rework?filter[original_spk_id][_in]=${reworkRequiredIds.join(',')}` +
				`&filter[rnd_reviewed_at][_null]=true&fields=original_spk_id&limit=-1`
		).catch(() => ({ data: [] }));
		unreviewedSpkIds = new Set((ncrRes?.data || []).map((r) => r.original_spk_id));
	}

	return spkRows.map((r) => {
		const stageKey = r.status === 'rework_required' && unreviewedSpkIds.has(r.id) ? 'menunggu_analisa_rnd' : r.status;
		return {
			id: r.id,
			nomor: r.nomor,
			product_name: r.product_id?.nama_barang_lengkap || null,
			quantity: r.quantity != null ? Number(r.quantity) : null,
			unit: r.unit || null,
			request_ref: r.request_ref || null,
			stage_key: stageKey,
			stage_label: PROJECT_STAGE_LABELS[stageKey] || stageKey,
			is_selesai: r.status === 'completed' || r.status === 'rework_completed',
			tanggal: r.tanggal || null
		};
	});
}

function deriveStageLabel(spkStatuses: string[]): { label: string; selesai: boolean } {
	if (spkStatuses.length === 0) return { label: 'Order Masuk', selesai: false };
	// Selesai = SEMUA SPK tuntas, baik jalur normal (completed) maupun via rework (rework_completed).
	if (spkStatuses.every((s) => s === 'completed' || s === 'rework_completed')) {
		return { label: 'Selesai Produksi — Siap/Dalam Kirim', selesai: true };
	}
	if (spkStatuses.every((s) => s === 'cancelled' || s === 'rejected')) {
		return { label: 'Dibatalkan/Ditolak', selesai: true };
	}
	// ambil status paling belum matang sebagai bottleneck (order baru selesai kalau SEMUA SPK selesai)
	const priority = ['requested', 'waiting_for_stock', 'worksheet_generated', 'in_progress', 'rework_required', 'qc_pending', 'qc_start', 'hold', 'rejected', 'completed', 'rework_completed', 'cancelled'];
	const worst = spkStatuses.reduce((acc, cur) => {
		const ai = priority.indexOf(acc);
		const ci = priority.indexOf(cur);
		return ci >= 0 && ci < ai ? cur : acc;
	}, spkStatuses[0]);
	return { label: STAGE_LABELS[worst] || worst, selesai: false };
}

/**
 * Ambil daftar paint_order milik sales yang sedang login (via so_customer.karyawan_id).
 * Least-privilege: tidak punya karyawanId → kembalikan array kosong, BUKAN semua order.
 */
export async function getMyPaintOrders(limit = 10): Promise<MyPaintOrder[]> {
	const s = get(authStore);
	if (!s.karyawanId) return [];

	const soRes = await secureDirectusJson<{ data: any[] }>(
		`/items/so_customer?filter[karyawan_id][_eq]=${s.karyawanId}` +
			`&filter[status][_nin]=cancelled,completed&sort=-id&limit=50&fields=id,nomor_so,customer_name`
	).catch(() => ({ data: [] }));
	const soRows = soRes?.data || [];
	if (soRows.length === 0) return [];
	const soById = new Map(soRows.map((r) => [r.id, r]));

	const ordersRes = await secureDirectusJson<{ data: any[] }>(
		`/items/paint_order?filter[so_id][_in]=${soRows.map((r) => r.id).join(',')}` +
			`&filter[is_batal][_eq]=false&sort=-id&limit=${limit}&fields=id,kode,so_id,spk_ids,target_kirim`
	).catch(() => ({ data: [] }));
	const orders = ordersRes?.data || [];
	if (orders.length === 0) return [];

	const allSpkIds = [...new Set(orders.flatMap((o) => o.spk_ids || []))];
	let spkById = new Map<number, any>();
	if (allSpkIds.length > 0) {
		const spkRes = await secureDirectusJson<{ data: any[] }>(
			// Fase 6.2: is_rework ditambahkan untuk badge "Batch rework".
			`/items/spk?filter[id][_in]=${allSpkIds.join(',')}&limit=-1&fields=id,status,is_rework`
		).catch(() => ({ data: [] }));
		spkById = new Map((spkRes?.data || []).map((r) => [r.id, r]));
	}

	return orders.map((o) => {
		const spkRows = (o.spk_ids || []).map((id: number) => spkById.get(id)).filter(Boolean);
		const statuses = spkRows.map((r: any) => r.status).filter(Boolean);
		const { label, selesai } = deriveStageLabel(statuses);
		const so = soById.get(o.so_id);
		const hasReworkBatch = spkRows.some((r: any) => r.is_rework || r.status === 'rework_required' || r.status === 'rework_completed');
		return {
			id: o.id,
			kode: o.kode,
			so_nomor: so?.nomor_so || null,
			customer_name: so?.customer_name || null,
			target_kirim: o.target_kirim || null,
			stage_label: label,
			is_selesai: selesai,
			has_rework_batch: hasReworkBatch
		};
	});
}
