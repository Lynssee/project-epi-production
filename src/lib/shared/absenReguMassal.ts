// src/lib/shared/absenReguMassal.ts
// PDP-24 — logika MURNI absen regu massal ("Hadir Semua" lalu kecualikan). Dipakai server & klien.
// Server tetap otoritas; fungsi ini hanya memvalidasi bentuk kiriman & merangkum hasil.

export const STATUS_MASSAL = ['hadir', 'setengah_hari', 'izin', 'sakit', 'alpha'] as const;
export type StatusMassal = (typeof STATUS_MASSAL)[number];

export interface EntriMassal {
	assignment_id: number;
	manpower_id: number;
	status: StatusMassal;
	catatan?: string;
}

export interface HasilEntri {
	manpower_id: number;
	ok: boolean;
	/** 'tercatat' = baru ditulis, 'sudah' = status sama sudah ada (tidak ditulis ulang), 'gagal' = ditolak. */
	hasil: 'tercatat' | 'sudah' | 'gagal';
	status: string;
	message: string;
}

export interface SetelanMassal {
	aktif: boolean;
	minAnggota: number;
	maksPerKirim: number;
}

export const SETELAN_MASSAL_DEFAULT: SetelanMassal = Object.freeze({ aktif: true, minAnggota: 5, maksPerKirim: 60 });

/** Perlu bukti foto+GPS? (hanya status berbiaya, sama dengan inti absensi). */
export const statusButuhBukti = (s: string): boolean => s === 'hadir' || s === 'setengah_hari';

/**
 * Parse `entries` (string JSON dari FormData). Entri rusak → error jelas, bukan dibuang diam-diam.
 * Duplikat manpower_id dalam satu kiriman ditolak (hindari akrual ganda).
 */
export function parseEntriMassal(
	raw: unknown,
	maks: number
): { ok: true; entries: EntriMassal[] } | { ok: false; error: string } {
	let arr: unknown = raw;
	if (typeof raw === 'string') {
		try {
			arr = JSON.parse(raw);
		} catch {
			return { ok: false, error: 'Daftar anggota (entries) bukan JSON yang valid.' };
		}
	}
	if (!Array.isArray(arr) || arr.length === 0) return { ok: false, error: 'Daftar anggota kosong.' };
	if (arr.length > maks) return { ok: false, error: `Maksimal ${maks} anggota per kiriman (diatur di setelan manpower).` };

	const seen = new Set<number>();
	const entries: EntriMassal[] = [];
	for (const e of arr as any[]) {
		const assignment_id = Number(e?.assignment_id);
		const manpower_id = Number(e?.manpower_id);
		const status = String(e?.status || '');
		if (!Number.isInteger(assignment_id) || !Number.isInteger(manpower_id)) {
			return { ok: false, error: 'Setiap anggota wajib punya assignment_id dan manpower_id.' };
		}
		if (!(STATUS_MASSAL as readonly string[]).includes(status)) {
			return { ok: false, error: `Status tidak dikenal: ${status}` };
		}
		if (seen.has(manpower_id)) return { ok: false, error: `Pekerja #${manpower_id} muncul dua kali dalam satu kiriman.` };
		seen.add(manpower_id);
		entries.push({ assignment_id, manpower_id, status: status as StatusMassal, catatan: e?.catatan ? String(e.catatan).slice(0, 200) : undefined });
	}
	return { ok: true, entries };
}

/** Setelan dari peta mentah (nilai bisa string JSON). Nilai tak valid → default. */
export function normalisasiSetelanMassal(raw: Record<string, unknown> | null | undefined): SetelanMassal {
	const num = (v: unknown, d: number, min: number, max: number) => {
		const n = Number(typeof v === 'string' ? v.replace(/["']/g, '') : v);
		return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : d;
	};
	const bool = (v: unknown, d: boolean) => {
		if (typeof v === 'boolean') return v;
		if (typeof v === 'number') return v !== 0;
		if (typeof v === 'string') {
			const s = v.replace(/["']/g, '').trim().toLowerCase();
			if (['true', '1', 'ya'].includes(s)) return true;
			if (['false', '0', 'tidak'].includes(s)) return false;
		}
		return d;
	};
	return {
		aktif: bool(raw?.['manpower.absen_regu_massal.aktif'], SETELAN_MASSAL_DEFAULT.aktif),
		minAnggota: num(raw?.['manpower.absen_regu_massal.min_anggota'], SETELAN_MASSAL_DEFAULT.minAnggota, 1, 200),
		maksPerKirim: num(raw?.['manpower.absen_regu_massal.maks_per_kirim'], SETELAN_MASSAL_DEFAULT.maksPerKirim, 1, 200)
	};
}

/** Tanggal lokal WIB (YYYY-MM-DD) untuk `now`. */
export function tanggalWIB(now: Date = new Date()): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Tanggal boleh dicatat: tidak di masa depan, tidak lebih tua dari `maksMundurHari` (backfill). */
export function tanggalBolehDicatat(tanggal: string, maksMundurHari: number, now: Date = new Date()): { ok: true } | { ok: false; error: string } {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return { ok: false, error: 'Tanggal tidak valid.' };
	const hariIni = tanggalWIB(now);
	if (tanggal > hariIni) return { ok: false, error: 'Tanggal absensi tidak boleh di masa depan.' };
	const selisih = Math.round((Date.parse(hariIni + 'T00:00:00Z') - Date.parse(tanggal + 'T00:00:00Z')) / 86_400_000);
	if (selisih > maksMundurHari) return { ok: false, error: `Absensi susulan maksimal ${maksMundurHari} hari ke belakang.` };
	return { ok: true };
}

export function ringkasHasil(hasil: HasilEntri[]) {
	const per: Record<string, number> = {};
	let gagal = 0;
	let sudah = 0;
	for (const h of hasil) {
		if (!h.ok) gagal += 1;
		else {
			if (h.hasil === 'sudah') sudah += 1;
			per[h.status] = (per[h.status] || 0) + 1;
		}
	}
	return { total: hasil.length, berhasil: hasil.length - gagal, gagal, sudah, per_status: per };
}
