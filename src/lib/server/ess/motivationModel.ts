// src/lib/server/ess/motivationModel.ts
// Salinan setia (subset sisi-input) dari erp-epi/src/lib/utils/motivationModel.js — jatuh tempo cek-in & validasi kiriman.
// Ubah KEDUANYA bersamaan. Agregasi/alert/HRD hanya ada di erp-epi (k-anonim). Semua fungsi null-safe.

export const TIPE = { MOOD: 'mood_mingguan', PULSE: 'pulse_belonging' } as const;

export const FAKTOR_OPTIONS = [
	{ value: 'kepemimpinan', label: 'Kepemimpinan / atasan' },
	{ value: 'rekan_kerja', label: 'Rekan kerja' },
	{ value: 'beban_kerja', label: 'Beban kerja' },
	{ value: 'fasilitas_alat', label: 'Fasilitas & alat kerja' },
	{ value: 'apresiasi', label: 'Apresiasi' },
	{ value: 'kejelasan_sop', label: 'Kejelasan SOP / arahan' }
];
const FAKTOR_VALUES = FAKTOR_OPTIONS.map((f) => f.value);
export const HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];

export function weekdayIndex(nama: unknown): number {
	const i = HARI.findIndex((h) => h.toLowerCase() === String(nama ?? '').trim().toLowerCase());
	return i >= 0 ? i + 1 : 1;
}

function parseYmd(ymd: unknown): { y: number; mo: number; d: number } | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? ''));
	return m ? { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) } : null;
}

export function weekdayOf(ymd: string): number {
	const p = parseYmd(ymd);
	if (!p) return 0;
	const dow = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
	return dow === 0 ? 7 : dow;
}

export function monthCode(ymd: string): string {
	const p = parseYmd(ymd);
	return p ? `${p.y}-${String(p.mo).padStart(2, '0')}` : '';
}

/** Kode minggu ISO 8601, mis. 2026-W46. */
export function isoWeekCode(ymd: string): string {
	const p = parseYmd(ymd);
	if (!p) return '';
	const date = new Date(Date.UTC(p.y, p.mo - 1, p.d));
	const dayNum = date.getUTCDay() || 7;
	date.setUTCDate(date.getUTCDate() + 4 - dayNum);
	const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
	const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export interface Due {
	tipe: string;
	periode_kode: string;
}

export function computeDue(opts: { today: string; settings: Record<string, unknown> | null; answered: Set<string> | string[] }): Due | null {
	const done = opts.answered instanceof Set ? opts.answered : new Set(Array.isArray(opts.answered) ? opts.answered : []);
	const s = opts.settings || {};
	const dom = parseYmd(opts.today)?.d ?? 0;
	const pulseDay = Math.min(28, Math.max(1, Math.trunc(Number(s['culture.pulse_enps_day_of_month'] ?? 1)) || 1));
	if (s['culture.mood_checkin_enabled'] !== false) {
		const pulseCode = monthCode(opts.today);
		if (pulseCode && dom >= pulseDay && !done.has(`${TIPE.PULSE}|${pulseCode}`)) return { tipe: TIPE.PULSE, periode_kode: pulseCode };
		const wk = isoWeekCode(opts.today);
		if (wk && weekdayOf(opts.today) >= weekdayIndex(s['culture.mood_checkin_day']) && !done.has(`${TIPE.MOOD}|${wk}`)) {
			return { tipe: TIPE.MOOD, periode_kode: wk };
		}
	}
	return null;
}

const intIn = (v: unknown, lo: number, hi: number): number | null => {
	const n = Number(v);
	return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
};

export interface CheckinData {
	tipe: string;
	skor_semangat: number;
	skor_belonging: number | null;
	skor_kejelasan_visi: number | null;
	faktor_utama: string | null;
	catatan_singkat: string | null;
	anonim: boolean;
}

export function validateCheckin(input: any, tipe: string): { ok: true; data: CheckinData } | { ok: false; error: string } {
	const i = input || {};
	const semangat = intIn(i.skor_semangat, 1, 5);
	if (semangat == null) return { ok: false, error: 'Pilih tingkat semangat (1–5).' };
	const data: CheckinData = { tipe, skor_semangat: semangat, skor_belonging: null, skor_kejelasan_visi: null, faktor_utama: null, catatan_singkat: null, anonim: i.anonim !== false };
	if (tipe === TIPE.PULSE) {
		data.skor_belonging = intIn(i.skor_belonging, 0, 10);
		data.skor_kejelasan_visi = intIn(i.skor_kejelasan_visi, 1, 5);
		if (data.skor_belonging == null) return { ok: false, error: 'Isi skor kebanggaan menjadi bagian dari EPI (0–10).' };
		if (data.skor_kejelasan_visi == null) return { ok: false, error: 'Isi seberapa jelas arah & target perusahaan (1–5).' };
	}
	const faktor = String(i.faktor_utama ?? '').trim();
	if (faktor) {
		if (!FAKTOR_VALUES.includes(faktor)) return { ok: false, error: 'Faktor utama tidak dikenal.' };
		data.faktor_utama = faktor;
	}
	const catatan = String(i.catatan_singkat ?? '').trim();
	if (catatan.length > 500) return { ok: false, error: 'Catatan maksimal 500 karakter.' };
	data.catatan_singkat = catatan || null;
	return { ok: true, data };
}
