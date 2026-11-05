// Pintasan belajar kontekstual (Program Pelatihan 5 Pilar, tindak lanjut): di halaman kerja Project Leader (Inspection,
// Field Report, Pusat Pengajuan) tampil kartu kecil "Belajar cepat" yang menaut ke kursus relevan yang BELUM lulus.
//
// Pemetaan halaman → kursus ada di app_settings training_lms/pintasan_konteks (JSON; diatur admin di /settings/training_lms).
// Tanpa baris itu dipakai DEFAULT_SHORTCUT_MAP. Pemilihan memakai kursus yang memang terlihat oleh karyawan itu
// (listCatalogForKaryawan sudah menyaring published + divisi), sehingga pintasan tak pernah menaut ke kursus yang tak bisa dibuka.
import { directusServerJson } from '$lib/server/directus';
import { getPillarConfig, pillarOfProgram, type PillarConfig } from '$lib/server/ess/trainingPillars';
import type { TrainingEnrollmentRecord, TrainingProgramRecord } from '$lib/services/ess/training';

export interface ShortcutRule {
	/** Kode program yang diprioritaskan (mis. KC-P3-QC). */
	kode?: string[];
	/** Pilar pengganti bila tak ada kursus berkode di atas yang tersedia. */
	pilar?: string;
}
export type ShortcutMap = Record<string, ShortcutRule>;

export const MAX_SHORTCUTS = 2;
export const SHORTCUT_SETTING_KEY = 'pintasan_konteks';

export const DEFAULT_SHORTCUT_MAP: ShortcutMap = {
	inspection: { kode: ['KC-P3-QC'], pilar: 'technical' },
	field_report: { kode: ['KC-P4-PROYEK'], pilar: 'management' },
	pengajuan: { pilar: 'administrative' }
};

export interface ShortcutItem {
	programId: number;
	judul: string;
	kode: string | null;
	pilar: string;
	pilarLabel: string;
	durasiMenit: number | null;
	progress: number;
	wajib: boolean;
	status: 'baru' | 'berjalan';
}

/** Normalisasi nilai setelan (string JSON / objek); rusak → default. Tidak pernah melempar. */
export function normalizeShortcutMap(raw: unknown): ShortcutMap {
	let src: any = raw;
	if (typeof src === 'string') {
		try { src = JSON.parse(src); } catch { src = null; }
	}
	if (!src || typeof src !== 'object' || Array.isArray(src)) return structuredClone(DEFAULT_SHORTCUT_MAP);
	const out: ShortcutMap = {};
	for (const [k, v] of Object.entries(src as Record<string, any>)) {
		const key = String(k).trim().toLowerCase();
		if (!key || !v || typeof v !== 'object') continue;
		const kode = Array.isArray(v.kode) ? v.kode.map((x: unknown) => String(x).trim()).filter(Boolean) : undefined;
		const pilar = typeof v.pilar === 'string' && v.pilar.trim() ? v.pilar.trim().toLowerCase() : undefined;
		if (!kode?.length && !pilar) continue;
		out[key] = { ...(kode?.length ? { kode } : {}), ...(pilar ? { pilar } : {}) };
	}
	return Object.keys(out).length ? out : structuredClone(DEFAULT_SHORTCUT_MAP);
}

/**
 * Pilih pintasan: kursus berkode prioritas dulu, lalu kursus se-pilar; yang sudah Lulus dibuang; urut wajib → berjalan → judul.
 * Pure — dites tanpa Directus.
 */
export function pickShortcuts(
	rule: ShortcutRule | undefined,
	programs: TrainingProgramRecord[],
	enrollments: TrainingEnrollmentRecord[],
	pillarConfig: PillarConfig,
	max = MAX_SHORTCUTS
): ShortcutItem[] {
	if (!rule) return [];
	const enr = new Map(enrollments.map((e) => [e.program_id, e]));
	const kodes = new Set((rule.kode ?? []).map((k) => k.toLowerCase()));
	const candidates = programs.filter((p) => enr.get(p.id)?.status !== 'Lulus');
	const byKode = kodes.size ? candidates.filter((p) => p.kode && kodes.has(p.kode.toLowerCase())) : [];
	const byPilar = rule.pilar ? candidates.filter((p) => pillarOfProgram(p, pillarConfig) === rule.pilar) : [];
	const seen = new Set<number>();
	const ordered: TrainingProgramRecord[] = [];
	const rank = (p: TrainingProgramRecord) => [p.wajib ? 0 : 1, (enr.get(p.id)?.progress_persen ?? 0) > 0 ? 0 : 1, p.judul] as const;
	const sortGroup = (g: TrainingProgramRecord[]) => [...g].sort((a, b) => {
		const ra = rank(a); const rb = rank(b);
		return ra[0] - rb[0] || ra[1] - rb[1] || ra[2].localeCompare(rb[2]);
	});
	for (const p of [...sortGroup(byKode), ...sortGroup(byPilar)]) {
		if (seen.has(p.id)) continue;
		seen.add(p.id);
		ordered.push(p);
	}
	return ordered.slice(0, max).map((p) => {
		const pilar = pillarOfProgram(p, pillarConfig);
		const progress = enr.get(p.id)?.progress_persen ?? 0;
		return {
			programId: p.id,
			judul: p.judul,
			kode: p.kode ?? null,
			pilar,
			pilarLabel: pillarConfig.pillars.find((x) => x.code === pilar)?.short ?? pilar,
			durasiMenit: p.durasi_menit ?? null,
			progress,
			wajib: !!p.wajib,
			status: progress > 0 ? 'berjalan' : 'baru'
		};
	});
}

const CACHE_TTL_MS = 300_000;
let _mapCache: { at: number; value: ShortcutMap } | null = null;
export function clearShortcutMapCache(): void {
	_mapCache = null;
}

/** Peta pintasan aktif (cache 5 menit). Gagal baca → default + log. */
export async function getShortcutMap(): Promise<ShortcutMap> {
	if (_mapCache && Date.now() - _mapCache.at < CACHE_TTL_MS) return _mapCache.value;
	let value = structuredClone(DEFAULT_SHORTCUT_MAP);
	try {
		const res = await directusServerJson<{ data: Array<{ setting_value: unknown }> }>(
			`/items/app_settings?filter[module][_eq]=training_lms&filter[setting_key][_eq]=${SHORTCUT_SETTING_KEY}&fields=setting_value&limit=1`
		);
		value = normalizeShortcutMap(res?.data?.[0]?.setting_value);
	} catch (err) {
		console.error('[trainingShortcut] gagal baca app_settings pintasan_konteks, pakai default:', err);
	}
	_mapCache = { at: Date.now(), value };
	return value;
}
