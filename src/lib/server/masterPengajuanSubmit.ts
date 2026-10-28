// src/lib/server/masterPengajuanSubmit.ts
// SERVER-ONLY. Katalog terpusat (master_pengajuan) untuk pengajuan dari lapangan.
// Salinan tipis dari erp-epi-1/src/lib/server/masterPengajuanEngine.js —
// kedua app berbagi Directus instance yang sama, jadi cukup menulis langsung
// tanpa HTTP cross-app (konsisten dengan approvalSubmit.ts).
//
// Panggilan selalu best-effort: caller wajib membungkus dengan try/catch dan
// tidak boleh memblokir pengajuan aslinya apabila fungsi ini gagal.

import { directusServerJson } from './directus';

// Fallback keras kalau entah kenapa master_pengajuan_katalog belum punya baris untuk
// jenis ini (seharusnya tidak terjadi setelah Fase 1 -- katalog jadi sumber tunggal
// lintas app, lihat erp-epi-1/src/lib/server/masterPengajuanEngine.js). BUKAN sumber
// kebenaran lagi -- jangan tambah entri baru di sini, tambah di katalog Directus.
const KODE_PREFIX_FALLBACK: Record<string, string> = {
	'PA-OPS': 'PA', 'PA-PRJ': 'PA', PR: 'PR', REQ: 'REQ', PJM: 'PJM',
	CTI: 'CTI', LMB: 'LMB', RMB: 'RMB', DOC: 'DOC', PKL: 'PKL',
	IZK: 'IZK', DSP: 'DSP', BBM: 'BBM', TRN: 'TRN'
};

// Cache koleksi spoke yang tidak punya field master_pengajuan_id. Diisi saat
// PATCH pertama gagal dengan error schema. Reset saat server restart.
const NO_BACKLINK_COLLECTIONS = new Set<string>();

// Cache pendek katalog (jarang berubah), TTL 5 menit -- sama pola dengan sisi Admin.
let katalogCache: Map<string, { jenis_pengajuan: string; kode_prefix: string | null }> | null = null;
let katalogCacheAt = 0;
const KATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchKatalogMap() {
	const now = Date.now();
	if (katalogCache && now - katalogCacheAt < KATALOG_CACHE_TTL_MS) return katalogCache;
	const res: any = await directusServerJson(
		'/items/master_pengajuan_katalog?fields=jenis_pengajuan,kode_prefix&limit=-1'
	);
	const map = new Map<string, { jenis_pengajuan: string; kode_prefix: string | null }>();
	for (const row of res?.data || []) map.set(row.jenis_pengajuan, row);
	katalogCache = map;
	katalogCacheAt = now;
	return map;
}

function yymm(): string {
	const d = new Date();
	return `${String(d.getFullYear()).slice(-2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Nomor pengajuan {KODE}-YYMM-XXXX. Diambil dari sufiks tertinggi yang sudah ada
 * (bukan COUNT) sehingga dua pengajuan paralel tidak menghasilkan nomor yang sama.
 * Prefix diturunkan dari master_pengajuan_katalog.kode_prefix (Fase 1, §6.3) --
 * satu sumber lintas app, bukan konstanta yang wajib disinkron manual dgn erp-epi-1.
 */
async function generateNomorPengajuan(jenisPengajuan: string): Promise<string> {
	const katalogMap = await fetchKatalogMap();
	const katalog = katalogMap.get(jenisPengajuan);
	const kode = katalog?.kode_prefix || KODE_PREFIX_FALLBACK[jenisPengajuan] || jenisPengajuan;
	const period = yymm();
	const prefix = `${kode}-${period}-`;
	const res: any = await directusServerJson(
		`/items/master_pengajuan?limit=1&sort=-nomor_pengajuan&fields=nomor_pengajuan&filter[nomor_pengajuan][_starts_with]=${encodeURIComponent(prefix)}`
	);
	const lastNomor: string = res?.data?.[0]?.nomor_pengajuan || '';
	const lastSuffix = lastNomor ? parseInt(lastNomor.split('-').pop() || '0', 10) : 0;
	const next = Number.isNaN(lastSuffix) ? 1 : lastSuffix + 1;
	return `${prefix}${String(next).padStart(4, '0')}`;
}

export interface CreateMasterPengajuanParams {
	kategori: string;
	jenisPengajuan: string;
	judul: string;
	deskripsi?: string | null;
	totalAmount?: number;
	pengajuId: number;
	departmentKey?: string | null;
	projectId?: number | null;
	detailRefCollection: string;
	detailRefId: number | string;
	approvalRequestId?: string | null;
	sourceApp: 'field' | 'admin';
	tags?: string[];
	clientTxnId?: string | null;
}

/**
 * Tulis satu baris katalog master_pengajuan. Retry sekali pada tabrakan nomor urut.
 * Tautan balik ke koleksi spoke dilewati diam-diam apabila field tidak ada.
 */
export async function createMasterPengajuanEntry({
	kategori, jenisPengajuan, judul, deskripsi = null, totalAmount = 0, pengajuId,
	departmentKey = null, projectId = null, detailRefCollection, detailRefId,
	approvalRequestId = null, sourceApp, tags = [], clientTxnId = null
}: CreateMasterPengajuanParams) {
	if (!kategori || !jenisPengajuan || !detailRefCollection || !detailRefId || !pengajuId) {
		throw new Error('createMasterPengajuanEntry: field wajib tidak lengkap');
	}

	// Idempotensi (A6, Fase 1): sama pola dengan projectLedger.appendLedgerEntry().
	if (clientTxnId) {
		const existing: any = await directusServerJson(
			`/items/master_pengajuan?filter[client_txn_id][_eq]=${encodeURIComponent(clientTxnId)}&limit=1`
		).catch(() => null);
		if (existing?.data?.length) {
			return existing.data[0];
		}
	}

	let nomorPengajuan = await generateNomorPengajuan(jenisPengajuan);
	let entry: any = null;

	for (let attempt = 0; attempt <= 1; attempt++) {
		try {
			const created: any = await directusServerJson('/items/master_pengajuan', {
				method: 'POST',
				body: JSON.stringify({
					nomor_pengajuan: nomorPengajuan,
					kategori,
					jenis_pengajuan: jenisPengajuan,
					judul,
					deskripsi,
					total_amount: totalAmount || 0,
					pengaju_id: pengajuId,
					department_key: departmentKey,
					project_id: projectId,
					detail_ref_collection: detailRefCollection,
					detail_ref_id: String(detailRefId),
					approval_request_id: approvalRequestId,
					source_app: sourceApp,
					tags,
					client_txn_id: clientTxnId
				})
			});
			entry = created?.data;
			if (entry?.id) break;
		} catch (e: any) {
			if (attempt === 0 && /unique|duplicate/i.test(e?.message || '')) {
				nomorPengajuan = await generateNomorPengajuan(jenisPengajuan);
				continue;
			}
			throw e;
		}
	}

	if (!entry?.id) throw new Error('Gagal membuat baris master_pengajuan');

	// Tautan balik best-effort — skip diam-diam kalau koleksi tidak punya field
	// master_pengajuan_id (koleksi lama / belum di-migrate). Koleksi yang sudah
	// diketahui tidak punya field di-cache agar PATCH tidak diulang setiap kali.
	if (!NO_BACKLINK_COLLECTIONS.has(detailRefCollection)) {
		try {
			await directusServerJson(`/items/${detailRefCollection}/${detailRefId}`, {
				method: 'PATCH',
				body: JSON.stringify({ master_pengajuan_id: entry.id })
			});
		} catch (e: any) {
			const msg: string = e?.message || '';
			if (/not allowed|doesn't exist|invalid payload/i.test(msg)) {
				NO_BACKLINK_COLLECTIONS.add(detailRefCollection);
			} else {
				console.warn(
					`[masterPengajuanSubmit] gagal tautan balik ${detailRefCollection}/${detailRefId}:`,
					msg
				);
			}
		}
	}

	return entry;
}
