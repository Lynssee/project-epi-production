// src/lib/server/lacakLink.ts
// SERVER-ONLY. Sisi Lapangan dari Pelacakan Lifecycle via QR/tautan (erp-epi: src/lib/server/trackingService.js).
// Tautan publik /lacak/<jenis>/<id>?h=<sig> diterbitkan erp-epi. Staf yang login di aplikasi Lapangan membukanya lewat
// /lacak/<jenis>/<id> di sini dan diarahkan ke layar yang memberi AKSI sesuai peran (mis. /scan/EPI:SJ:<id>:<token>),
// bukan hanya halaman baca-saja publik.
//
// Tanda tangan = HMAC-SHA256(secret, "doktrack:v1:<jenis>:<id>") dipotong 22 karakter base64url — PORT PERSIS dari erp-epi.
// Rahasia: DOC_VERIFY_SECRET (fallback AUTOMATION_SERVER_SECRET) HARUS SAMA dengan di erp-epi (pola sama hrDocVerify.ts).
// Vektor uji tetap di lacakLink.test.ts menjaga kedua sisi tidak menyimpang. Tanpa rahasia: verifikasi false (tak ada kunci bawaan).

import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

const ERP_ORIGIN = () => (env.ERP_EPI1_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://internal.eltamaprimaindo.com' : 'http://localhost:9390')).replace(/\/$/, '');

/** URL halaman publik (baca-saja) di erp-epi untuk tautan yang sama — jalan keluar bila aksi tidak tersedia. `publik=1` mencegah auto-redirect balik. */
export const publicLacakUrl = (jenis: string, id: string, sig: string): string => `${ERP_ORIGIN()}/lacak/${encodeURIComponent(jenis)}/${encodeURIComponent(id)}?h=${encodeURIComponent(sig)}&publik=1`;

// HARUS sama dengan ALL_TRACK_JENIS di erp-epi ($lib/shared/trackingDefs.js). Jenis tanpa layar khusus di Lapangan
// (trf, produksi, fleet) membuka halaman publik erp-epi (baca-saja) — lihat lacakTarget.
export const LACAK_JENIS = ['sj', 'mutasi', 'pl', 'bk', 'trf', 'produksi', 'fleet', 'maintenance', 'komplain', 'returgudang'] as const;
/** Jenis yang koleksinya ber-id UUID (bukan integer). */
const UUID_JENIS: readonly string[] = ['fleet', 'maintenance'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type LacakJenis = (typeof LACAK_JENIS)[number];
const SIG_LEN = 22;

export const isLacakJenis = (j: unknown): j is LacakJenis => typeof j === 'string' && (LACAK_JENIS as readonly string[]).includes(j);
/** id dokumen = bilangan bulat positif, maksimal 12 digit (sama dengan erp-epi). */
export const isValidLacakId = (id: unknown, jenis?: unknown): boolean =>
	 typeof jenis === 'string' && UUID_JENIS.includes(jenis) ? UUID_RE.test(String(id ?? '')) : /^[1-9]\d{0,11}$/.test(String(id ?? ''));

function mac(jenis: string, id: string): string {
	const secret = env.DOC_VERIFY_SECRET || env.AUTOMATION_SERVER_SECRET;
	if (!secret) throw new Error('DOC_VERIFY_SECRET (atau AUTOMATION_SERVER_SECRET) belum dikonfigurasi di server');
	return createHmac('sha256', secret).update(`doktrack:v1:${jenis}:${id}`).digest('base64url').slice(0, SIG_LEN);
}

/** Cek tanda tangan, waktu-konstan. Tidak pernah melempar. */
export function verifyLacakSig(jenis: unknown, id: unknown, sig: unknown): boolean {
	try {
		if (!isLacakJenis(jenis) || !isValidLacakId(id, jenis) || typeof sig !== 'string' || sig.length !== SIG_LEN) return false;
		const expected = Buffer.from(mac(jenis, String(id)));
		const given = Buffer.from(sig);
		return expected.length === given.length && timingSafeEqual(expected, given);
	} catch {
		return false;
	}
}

export interface LacakRows {
	/** surat_jalan.qr_token (null bila belum ada) */
	sjQrToken?: string | null;
	/** packing_list.project_id (null bila tak ada) */
	plProjectId?: number | null;
}

/**
 * Tujuan dalam aplikasi Lapangan. FUNGSI MURNI (data dokumen diberikan pemanggil) — mudah diuji.
 *  - sj     -> /scan/EPI:SJ:<id>:<token> (aksi per peran: gerbang, terima barang, lihat detail); tanpa token -> /lacak-sj/<id>
 *  - mutasi -> /mutasi-barang?doc=<id> (kartu dokumen disorot; aksi terima/kirim sesuai peran)
 *  - pl     -> /packing-list?proyek=<project_id> (kartu proyek dibuka) bila diketahui, selain itu /packing-list
 *  - bk     -> /requisition/<id> (detail Barang Keluar)
 */
export function lacakTarget(jenis: LacakJenis, id: string | number, rows: LacakRows = {}): { target: string | null; label: string } {
	if (jenis === 'sj') {
		return rows.sjQrToken
			? { target: `/scan/${encodeURIComponent(`EPI:SJ:${id}:${rows.sjQrToken}`)}`, label: 'Surat Jalan — aksi sesuai peran Anda' }
			: { target: `/lacak-sj/${id}`, label: 'Detail Surat Jalan' };
	}
	if (jenis === 'mutasi') return { target: `/mutasi-barang?doc=${id}`, label: 'Mutasi Barang' };
	if (jenis === 'bk') return { target: `/requisition/${id}`, label: 'Barang Keluar' };
	// trf/produksi/fleet: belum ada layar per-dokumen di Lapangan → target null = buka halaman publik (baca-saja).
	if (jenis === 'trf') return { target: null, label: 'Transfer Antar Gudang' };
	if (jenis === 'produksi') return { target: null, label: 'SPK Produksi' };
	if (jenis === 'fleet') return { target: null, label: 'Booking Kendaraan' };
	if (jenis === 'maintenance') return { target: null, label: 'Work Order Maintenance' };
	if (jenis === 'komplain') return { target: null, label: 'Komplain' };
	if (jenis === 'returgudang') return { target: null, label: 'Retur Barang ke Gudang' };
	const pid = Number(rows.plProjectId);
	return Number.isInteger(pid) && pid > 0 ? { target: `/packing-list?proyek=${pid}`, label: 'Packing List proyek' } : { target: '/packing-list', label: 'Packing List' };
}
