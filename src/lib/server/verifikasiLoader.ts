// src/lib/server/verifikasiLoader.ts
// ⚠️ SERVER-ONLY. Data yang tampil di halaman verifikasi PUBLIK (QR). Keputusan Lead: HANYA nomor dokumen, jenis,
// status, tanggal, dan nominal. Tanpa nama pemohon, rekening, bank, proyek, atau rincian item.
// `toPublicView` adalah WHITELIST murni — field apa pun di luar daftar tidak akan pernah ikut keluar, walau query
// Directus kelak menambah field. Dites agar tidak bocor.
import { directusServerJson } from '$lib/server/directus';
import type { JenisVerifikasi } from '$lib/server/verifikasiDokumen';

export interface VerifikasiView {
	jenis: JenisVerifikasi;
	jenis_label: string;
	nomor: string;
	status: string;
	tanggal: string | null;
	nominal: number;
	nominal_label: string;
}

const JENIS_LABEL: Record<JenisVerifikasi, string> = { pa: 'Pengajuan Anggaran', bdp: 'Voucher Pembayaran Kolektif' };

const PA_FIELDS = 'id,nomor_pengajuan,status,date_created,jumlah_disetujui,total_amount';
const BDP_FIELDS = 'id,nomor_voucher,status,tanggal_bayar,date_created,total_amount';

/** WHITELIST: hanya field publik yang dikembalikan. */
export function toPublicView(jenis: JenisVerifikasi, raw: any): VerifikasiView | null {
	if (!raw || typeof raw !== 'object') return null;
	if (jenis === 'pa') {
		const disetujui = Number(raw.jumlah_disetujui) || 0;
		return {
			jenis,
			jenis_label: JENIS_LABEL.pa,
			nomor: String(raw.nomor_pengajuan || `#${raw.id ?? ''}`),
			status: String(raw.status || '-'),
			tanggal: raw.date_created ? String(raw.date_created) : null,
			nominal: disetujui > 0 ? disetujui : Number(raw.total_amount) || 0,
			nominal_label: disetujui > 0 ? 'Nominal disetujui' : 'Nominal diajukan'
		};
	}
	return {
		jenis,
		jenis_label: JENIS_LABEL.bdp,
		nomor: String(raw.nomor_voucher || `#${raw.id ?? ''}`),
		status: String(raw.status || '-'),
		tanggal: raw.tanggal_bayar ? String(raw.tanggal_bayar) : raw.date_created ? String(raw.date_created) : null,
		nominal: Number(raw.total_amount) || 0,
		nominal_label: 'Total terbayar'
	};
}

/** @returns null bila dokumen tidak ada / gagal dimuat (pemanggil memberi respons seragam). */
export async function loadVerifikasi(jenis: JenisVerifikasi, id: string): Promise<VerifikasiView | null> {
	const path = jenis === 'pa' ? `/items/pengajuan_anggaran/${id}?fields=${PA_FIELDS}` : `/items/batch_disbursement/${id}?fields=${BDP_FIELDS}`;
	try {
		const res = await directusServerJson<{ data: any }>(path);
		return toPublicView(jenis, res?.data);
	} catch (e: any) {
		console.warn(`[verifikasi] dokumen ${jenis}/${id} tak termuat:`, e?.message || e);
		return null;
	}
}
