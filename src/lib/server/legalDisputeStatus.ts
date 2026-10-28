// src/lib/server/legalDisputeStatus.ts
// Badge sengketa hukum penagihan untuk Dashboard Lapangan (3 Okt 2026). READ-ONLY dan
// SENGAJA minim: hanya {aktif, tahap} — TANPA nominal, nomor PA, atau nama advokat
// (konsisten dengan keputusan Lead soal B2B: PL tidak melihat angka sensitif).
// Sumber: PA kategori jasa_hukum_penagihan berstatus disetujui (erp-epi), dicocokkan ke
// customer proyek lewat projects.so_customer_id -> so_customer.kode_customer -> master_customer.id.
// Fetch dipisah per koleksi (aturan Directus 403). Fail-soft: error -> tidak aktif + log.

import { directusServerJson } from './directus';

export const LEGAL_DISPUTE_PA_STATUSES = ['Approved', 'Completed', 'Dibukukan'];
const TAHAP_LITIGASI = ['arbitrase', 'litigasi_perdata', 'eksekusi_jaminan'];

export type DisputeTahap = 'somasi' | 'litigasi';

/** Fungsi murni: dari baris PA + id master_customer -> tahap terberat, atau null bila tak ada sengketa. */
export function deriveDisputeTahap(
	rows: Array<{ status?: string | null; dynamic_fields?: any }> | null | undefined,
	masterCustomerId: number | string
): DisputeTahap | null {
	let tahap: DisputeTahap | null = null;
	for (const r of rows || []) {
		if (!LEGAL_DISPUTE_PA_STATUSES.includes(String(r?.status))) continue;
		const dyn = r?.dynamic_fields && typeof r.dynamic_fields === 'object' ? r.dynamic_fields : {};
		const raw = dyn.customer_id;
		const cid = raw && typeof raw === 'object' ? raw.id : raw;
		if (cid == null || String(cid) !== String(masterCustomerId)) continue;
		tahap = TAHAP_LITIGASI.includes(String(dyn.jenis_perkara)) ? 'litigasi' : tahap ?? 'somasi';
	}
	return tahap;
}

export async function getProjectLegalDispute(projectId: number | string): Promise<{ aktif: boolean; tahap: DisputeTahap | null }> {
	const none = { aktif: false, tahap: null as DisputeTahap | null };
	try {
		const proj = await directusServerJson<{ data: { so_customer_id: any } }>(
			`/items/projects/${encodeURIComponent(String(projectId))}?fields=id,so_customer_id`
		);
		const soRaw = proj?.data?.so_customer_id;
		const soId = soRaw && typeof soRaw === 'object' ? soRaw.id : soRaw;
		if (!soId) return none;

		const so = await directusServerJson<{ data: { kode_customer: string | null } }>(
			`/items/so_customer/${encodeURIComponent(String(soId))}?fields=id,kode_customer`
		);
		const kode = so?.data?.kode_customer;
		if (!kode) return none;

		const cust = await directusServerJson<{ data: Array<{ id: number }> }>(
			`/items/master_customer?filter[kode_customer][_eq]=${encodeURIComponent(kode)}&fields=id&limit=1`
		);
		const custId = cust?.data?.[0]?.id;
		if (!custId) return none;

		const pa = await directusServerJson<{ data: any[] }>(
			`/items/pengajuan_anggaran?filter[kategori_belanja][_eq]=jasa_hukum_penagihan` +
				`&filter[status][_in]=${LEGAL_DISPUTE_PA_STATUSES.join(',')}&fields=id,status,dynamic_fields&limit=-1`
		);
		const tahap = deriveDisputeTahap(pa?.data, custId);
		return { aktif: tahap !== null, tahap };
	} catch (e) {
		console.warn('[legalDisputeStatus] gagal menentukan sengketa hukum proyek', projectId, (e as Error)?.message || e);
		return none;
	}
}
