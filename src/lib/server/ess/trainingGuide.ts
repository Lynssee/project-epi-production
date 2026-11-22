// Panduan singkat "Cara Kerja Kurikulum, Kuis & Sertifikat" untuk kru lapangan.
//
// CERMIN sisi-baca dari erp-epi `utils/trainingCurriculumGuide.js` (field_steps). HRD mengubah teksnya di
// HRD → Pelatihan → 🧭 Panduan Kurikulum; disimpan di app_settings (module `training_lms`, key `curriculum_guide_config`).
// Tanpa setelan tersimpan, DEFAULT_FIELD_STEPS dipakai. Ubah default di KEDUA repo bersamaan.
import { directusServerJson } from '$lib/server/directus';

export const DEFAULT_FIELD_STEPS: string[] = [
	'Cek Silabus Jabatan & Learning Path (urutan kursus wajib jabatan Anda).',
	'Pelajari Modul: tonton video / baca panduan sampai tuntas.',
	'Kerjakan Kuis sampai mencapai nilai lulus (KKM).',
	'Praktik di proyek & review atasan/mentor → sertifikat terbit.'
];

/** Validasi; tidak pernah melempar. Kosong/rusak → default. Maks. 8 langkah, tiap langkah ≤ 400 karakter. */
export function normalizeFieldSteps(raw: unknown): string[] {
	let src: any = raw;
	if (typeof src === 'string') {
		try { src = JSON.parse(src); } catch { src = null; }
	}
	const list = Array.isArray(src?.field_steps) ? src.field_steps : [];
	const steps = list.map((s: unknown) => (typeof s === 'string' ? s.trim().slice(0, 400) : '')).filter(Boolean).slice(0, 8);
	return steps.length ? steps : [...DEFAULT_FIELD_STEPS];
}

const CACHE_TTL_MS = 300_000;
let _cache: { at: number; value: string[] } | null = null;

/** Langkah panduan lapangan (cache 5 menit). Gagal baca → default + log jelas; halaman tetap tampil. */
export async function getFieldGuideSteps(): Promise<string[]> {
	if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.value;
	let value = [...DEFAULT_FIELD_STEPS];
	try {
		const res = await directusServerJson<{ data: Array<{ setting_value: unknown }> }>(
			'/items/app_settings?filter[module][_eq]=training_lms&filter[setting_key][_eq]=curriculum_guide_config&fields=setting_value&limit=1'
		);
		value = normalizeFieldSteps(res?.data?.[0]?.setting_value);
	} catch (err) {
		console.error('[trainingGuide] gagal baca app_settings curriculum_guide_config, pakai default:', err);
	}
	_cache = { at: Date.now(), value };
	return value;
}

export function clearFieldGuideCache(): void {
	_cache = null;
}
