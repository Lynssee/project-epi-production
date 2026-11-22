// src/lib/utils/sertifikatKartu.ts
// Kartu Sertifikat Digital: aturan murni (tanpa fetch) — status masa berlaku & urutan tampil. Null-safe (CLAUDE.md #7).

export type StatusSertifikat = 'aktif' | 'segera_habis' | 'kedaluwarsa' | 'tanpa_batas';

export const DEFAULT_WARN_DAYS = 30;

/** Selisih hari kalender (b - a) untuk dua tanggal YYYY-MM-DD; NaN bila salah satu rusak. */
export function selisihHari(a: string, b: string): number {
	const ta = Date.parse(`${String(a).slice(0, 10)}T00:00:00Z`);
	const tb = Date.parse(`${String(b).slice(0, 10)}T00:00:00Z`);
	return Math.round((tb - ta) / 86_400_000);
}

export function statusSertifikat(expired: string | null | undefined, today: string, warnDays: number = DEFAULT_WARN_DAYS): StatusSertifikat {
	if (!expired) return 'tanpa_batas';
	const sisa = selisihHari(today, expired);
	if (!Number.isFinite(sisa)) return 'tanpa_batas'; // tanggal rusak: jangan menuduh kedaluwarsa
	if (sisa < 0) return 'kedaluwarsa';
	return sisa <= Math.max(0, warnDays) ? 'segera_habis' : 'aktif';
}

export interface KartuSertifikat {
	enrollmentId: number;
	programId: number;
	judul: string;
	kode: string | null;
	sertifikatNo: string;
	nilaiAkhir: number | null;
	expired: string | null;
	status: StatusSertifikat;
	sisaHari: number | null;
	/** URL verifikasi publik (berQR). null bila secret server belum di-set → kartu tampil tanpa QR. */
	verifyUrl: string | null;
}

const URUT: Record<StatusSertifikat, number> = { kedaluwarsa: 0, segera_habis: 1, aktif: 2, tanpa_batas: 3 };

/** Perhatian dulu: kedaluwarsa & segera habis di atas, lalu yang paling cepat habis. */
export function urutkanKartu<T extends { status: StatusSertifikat; sisaHari: number | null; judul: string }>(list: T[] | null | undefined): T[] {
	return (Array.isArray(list) ? list.slice() : []).sort(
		(a, b) => URUT[a.status] - URUT[b.status] || (a.sisaHari ?? 1e9) - (b.sisaHari ?? 1e9) || a.judul.localeCompare(b.judul, 'id')
	);
}

export function ringkasKartu(list: Array<{ status: StatusSertifikat }> | null | undefined) {
	const l = Array.isArray(list) ? list : [];
	return {
		total: l.length,
		aktif: l.filter((k) => k.status === 'aktif' || k.status === 'tanpa_batas').length,
		segeraHabis: l.filter((k) => k.status === 'segera_habis').length,
		kedaluwarsa: l.filter((k) => k.status === 'kedaluwarsa').length
	};
}
