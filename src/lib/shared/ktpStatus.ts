// src/lib/shared/ktpStatus.ts
// PDP-25 — status KTP/NIK per pekerja untuk layar Regu lapangan. MURNI. Kembar logika erp-epi
// (src/lib/data/ktpReadiness.js + src/lib/utils/nikValidity.js) — jaga keduanya tetap sama.

export type NikStatus = 'kosong' | 'tidak_valid' | 'valid';
export type KtpStatus = 'terverifikasi' | 'menunggu' | 'ditolak' | 'belum';

export function nikStatus(raw: unknown): NikStatus {
	const s = String(raw ?? '').trim();
	if (!s) return 'kosong';
	if (/^\d{16}$/.test(s) && !/0{10}$/.test(s)) return 'valid';
	return 'tidak_valid';
}

/** terverifikasi > menunggu > ditolak > belum (hanya dokumen jenis 'ktp'). */
export function statusKtp(docs: Array<{ jenis_dokumen?: string; status_verifikasi?: string | null }> | null | undefined): KtpStatus {
	const ktp = (docs || []).filter((d) => d?.jenis_dokumen === 'ktp');
	if (ktp.some((d) => d.status_verifikasi === 'terverifikasi')) return 'terverifikasi';
	if (ktp.some((d) => d.status_verifikasi === 'menunggu' || !d.status_verifikasi)) return 'menunggu';
	if (ktp.some((d) => d.status_verifikasi === 'ditolak')) return 'ditolak';
	return 'belum';
}

export interface StatusIdentitas {
	nik: NikStatus;
	ktp: KtpStatus;
	/** Alasan HRD menolak KTP (hanya saat ktp === 'ditolak'). */
	alasanTolak?: string | null;
}

/** Gabungkan baris manpower (NIK) dan dokumen KTP menjadi peta manpowerId → status. */
export function petaStatusIdentitas(
	manpower: Array<{ id: number; NIK?: unknown }>,
	dokumen: Array<{ manpower_id?: any; jenis_dokumen?: string; status_verifikasi?: string | null; catatan_verifikasi?: string | null }>
): Record<number, StatusIdentitas> {
	const docsBy = new Map<number, any[]>();
	for (const d of dokumen || []) {
		const mid = Number(d?.manpower_id && typeof d.manpower_id === 'object' ? d.manpower_id.id : d?.manpower_id);
		if (!Number.isFinite(mid)) continue;
		if (!docsBy.has(mid)) docsBy.set(mid, []);
		docsBy.get(mid)!.push(d);
	}
	const out: Record<number, StatusIdentitas> = {};
	for (const m of manpower || []) {
		const docs = docsBy.get(m.id);
		const ktp = statusKtp(docs);
		const alasan = ktp === 'ditolak' ? [...(docs || [])].reverse().find((d) => d?.status_verifikasi === 'ditolak' && d?.catatan_verifikasi)?.catatan_verifikasi : null;
		out[m.id] = { nik: nikStatus(m.NIK), ktp, ...(alasan ? { alasanTolak: String(alasan) } : {}) };
	}
	return out;
}

/** Identitas sudah beres (cukup untuk gate G_MANPOWER_IDENTITAS)? */
export const identitasLengkap = (s: StatusIdentitas | undefined): boolean => !!s && s.nik === 'valid' && s.ktp === 'terverifikasi';
