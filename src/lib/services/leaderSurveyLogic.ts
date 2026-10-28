// src/lib/services/leaderSurveyLogic.ts
// Logika murni survei lapangan oleh Leader (Fase 3 plan "Penguraian PO Jasa", 10 Okt 2026).
// Survei disimpan di `sales_survey` (satu per so_customer_id) -- sumber yang SUDAH dibaca ProjectCharterTab.
// Prinsip: Leader tidak boleh menimpa isian Sales; untuk survei yang sudah ada, hanya field KOSONG yang diisi.

export const LEADER_SURVEY_FIELDS = [
	'lokasi_project',
	'pic_lapangan',
	'pic_lapangan_telp',
	'tanggal_mulai_target',
	'tanggal_selesai_target',
	'luas_area',
	'kondisi_permukaan',
	'akses_lokasi',
	'ketersediaan_listrik',
	'ketersediaan_air',
	'ketersediaan_toilet',
	'jam_kerja_diizinkan',
	'shift_kerja',
	'akomodasi',
	'kebutuhan_safety',
	'catatan_khusus'
] as const;

export type LeaderSurveyField = (typeof LEADER_SURVEY_FIELDS)[number];
export type LeaderSurveyForm = Partial<Record<LeaderSurveyField, string | number | null>>;

/** Nilai dianggap kosong bila null/undefined/string kosong (angka 0 bukan kosong). */
export function isBlank(v: unknown): boolean {
	return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/** Normalisasi isian form: trim string, kosong -> null, luas_area -> angka positif atau null. */
export function normalizeForm(form: LeaderSurveyForm): LeaderSurveyForm {
	const out: LeaderSurveyForm = {};
	for (const key of LEADER_SURVEY_FIELDS) {
		const raw = form[key];
		if (isBlank(raw)) {
			out[key] = null;
			continue;
		}
		if (key === 'luas_area') {
			const n = Number(String(raw).replace(',', '.'));
			out[key] = Number.isFinite(n) && n > 0 ? n : null;
		} else {
			out[key] = typeof raw === 'string' ? raw.trim() : raw;
		}
	}
	return out;
}

/**
 * Payload PATCH untuk survei yang sudah ada: hanya field yang di database masih kosong DAN diisi Leader.
 * Mengembalikan juga daftar field yang dilewati karena sudah terisi (untuk ditampilkan ke Leader).
 */
export function buildFillEmptyPatch(
	existing: Record<string, unknown>,
	form: LeaderSurveyForm
): { patch: Record<string, unknown>; skipped: LeaderSurveyField[] } {
	const clean = normalizeForm(form);
	const patch: Record<string, unknown> = {};
	const skipped: LeaderSurveyField[] = [];
	for (const key of LEADER_SURVEY_FIELDS) {
		const next = clean[key];
		if (isBlank(next)) continue;
		if (isBlank(existing?.[key])) patch[key] = next;
		else if (String(existing[key]) !== String(next)) skipped.push(key);
	}
	return { patch, skipped };
}

/** Validasi minimum survei baru: lokasi wajib; target selesai tidak boleh sebelum target mulai. */
export function validateNewSurvey(form: LeaderSurveyForm): string | null {
	const c = normalizeForm(form);
	if (isBlank(c.lokasi_project)) return 'Lokasi proyek wajib diisi.';
	const a = c.tanggal_mulai_target as string | null;
	const b = c.tanggal_selesai_target as string | null;
	if (a && b && b < a) return 'Target selesai tidak boleh sebelum target mulai.';
	return null;
}
