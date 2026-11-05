// 5 Pilar Knowledge pelatihan (Product, Technical, Management, General, Administrative) — sisi lapangan.
//
// CERMIN dari erp-epi `src/lib/services/trainingPillars.js` (admin). Pemetaan kategori → pilar disimpan
// di app_settings (module `training_lms`, key `pilar_pemetaan`) dan diatur admin di HRD → Pelatihan → Pengaturan.
// Ubah DEFAULT_PILLAR_CONFIG di KEDUA repo bersamaan. Tanpa setelan tersimpan, default ini dipakai.
import { directusServerJson } from '$lib/server/directus';

export interface PillarDef {
	code: string;
	label: string;
	short: string;
	icon: string;
	kategori: string[];
	hint: string;
}

export interface PillarConfig {
	fallback_pillar: string;
	pillars: PillarDef[];
	/** { "<program_id>": "<kode pilar>" } */
	program_overrides: Record<string, string>;
}

export const DEFAULT_PILLAR_CONFIG: PillarConfig = {
	fallback_pillar: 'general',
	pillars: [
		{ code: 'product', label: 'Product Knowledge', short: 'Product', icon: '🧪', kategori: ['Sales', 'Product'], hint: 'Produk, TDS/MSDS, keunggulan dan cara menjelaskan produk ke customer.' },
		{ code: 'technical', label: 'Technical Knowledge', short: 'Technical', icon: '🛠️', kategori: ['Project', 'Maintenance', 'K3', 'Technical'], hint: 'Sandblasting, aplikasi cat, QC inspeksi, K3 lapangan, perawatan alat.' },
		{ code: 'management', label: 'Management Knowledge', short: 'Management', icon: '📈', kategori: ['Management'], hint: 'Kepemimpinan, manajemen proyek, RAP & kontrol biaya, komunikasi.' },
		{ code: 'general', label: 'General Knowledge', short: 'General', icon: '🏢', kategori: ['Umum', 'General'], hint: 'Aturan & budaya perusahaan, onboarding, K3 umum, keamanan informasi.' },
		{ code: 'administrative', label: 'Administrative Knowledge', short: 'Administrative', icon: '🗂️', kategori: ['Tutorial', 'Administrative'], hint: 'Alur pengajuan (cuti, kasbon, lembur, anggaran), tutorial ERP, kepatuhan SOP.' }
	],
	program_overrides: {}
};

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Validasi + normalisasi; tidak pernah melempar — input rusak jatuh ke default. */
export function normalizePillarConfig(raw: unknown): PillarConfig {
	let src: any = raw;
	if (typeof src === 'string') {
		try { src = JSON.parse(src); } catch { src = null; }
	}
	if (!src || typeof src !== 'object' || !Array.isArray(src.pillars) || src.pillars.length === 0) {
		return structuredClone(DEFAULT_PILLAR_CONFIG);
	}
	const seen = new Set<string>();
	const pillars: PillarDef[] = [];
	for (const p of src.pillars) {
		const code = str(p?.code).toLowerCase();
		if (!code || seen.has(code)) continue;
		seen.add(code);
		const label = str(p?.label) || code;
		pillars.push({
			code,
			label,
			short: str(p?.short) || label,
			icon: str(p?.icon) || '📘',
			kategori: [...new Set((Array.isArray(p?.kategori) ? p.kategori : []).map(str).filter(Boolean))] as string[],
			hint: str(p?.hint)
		});
	}
	if (pillars.length === 0) return structuredClone(DEFAULT_PILLAR_CONFIG);
	const codes = new Set(pillars.map((p) => p.code));
	const wanted = str(src.fallback_pillar).toLowerCase();
	const program_overrides: Record<string, string> = {};
	for (const [pid, code] of Object.entries(src.program_overrides || {})) {
		const c = str(code).toLowerCase();
		if (codes.has(c)) program_overrides[String(pid)] = c;
	}
	return { fallback_pillar: codes.has(wanted) ? wanted : pillars[0].code, pillars, program_overrides };
}

/** Kode pilar sebuah program: override per-program → kategori → fallback. */
export function pillarOfProgram(program: { id: number | string; kategori?: string | null } | null, config: PillarConfig): string {
	if (!program) return config.fallback_pillar;
	const override = config.program_overrides[String(program.id)];
	if (override) return override;
	const kategori = str(program.kategori).toLowerCase();
	if (kategori) {
		const hit = config.pillars.find((p) => p.kategori.some((k) => k.toLowerCase() === kategori));
		if (hit) return hit.code;
	}
	return config.fallback_pillar;
}

const CACHE_TTL_MS = 300_000;
let _cache: { at: number; value: PillarConfig } | null = null;

/** Konfigurasi pilar aktif (cache 5 menit). Gagal baca → default + log jelas, katalog tetap tampil. */
export async function getPillarConfig(): Promise<PillarConfig> {
	if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.value;
	let value = structuredClone(DEFAULT_PILLAR_CONFIG);
	try {
		const res = await directusServerJson<{ data: Array<{ setting_value: unknown }> }>(
			'/items/app_settings?filter[module][_eq]=training_lms&filter[setting_key][_eq]=pilar_pemetaan&fields=setting_value&limit=1'
		);
		value = normalizePillarConfig(res?.data?.[0]?.setting_value);
	} catch (err) {
		console.error('[trainingPillars] gagal baca app_settings pilar_pemetaan, pakai default:', err);
	}
	_cache = { at: Date.now(), value };
	return value;
}

export function clearPillarConfigCache(): void {
	_cache = null;
}
