// Indikator Sumber Pelatihan — sisi lapangan (Inventory 360° ↔ Training, Fase 4).
//
// CERMIN RINGKAS dari erp-epi `src/lib/utils/trainingSourceRegistry.js` (Fase 1). Deteksi hanya dari kolom program yang
// sudah ada (kode, created_by, judul, deskripsi bertag `[Sumber: key]`). Label/ikon/aktif dapat ditimpa admin di
// HRD → Pelatihan → Pengaturan (app_settings module `training_lms`, key `source_registry`); cache 5 menit.
// Ubah daftar sumber / aturan deteksi di KEDUA repo bersamaan.
import { directusServerJson } from '$lib/server/directus';

export interface SumberDef { key: string; label: string; icon: string; aktif: boolean }
export interface SumberPelatihan { key: string; label: string; icon: string }

export const DEFAULT_SUMBER: SumberDef[] = [
	{ key: 'inv360_item', label: 'Inventory 360° (Barang)', icon: '📦', aktif: true },
	{ key: 'inv360_model', label: 'Inventory 360° (Equipment)', icon: '🚜', aktif: true },
	{ key: 'sop_doc', label: 'SOP Dokumen', icon: '📄', aktif: true },
	{ key: 'process_flow', label: 'Peta Alur Bisnis', icon: '🗺️', aktif: true },
	{ key: 'rnd_knowledge', label: 'R&D & Produk 360°', icon: '🧪', aktif: true },
	{ key: 'ncr_case', label: 'Studi Kasus QC / NCR', icon: '🛡️', aktif: true },
	{ key: 'maint_p2h', label: 'Maintenance & P2H', icon: '🔧', aktif: true },
	{ key: 'hse_jsa', label: 'HSE / K3 & JSA', icon: '🦺', aktif: true },
	{ key: 'ext_tds_msds', label: 'Eksternal: TDS / MSDS', icon: '📑', aktif: true },
	{ key: 'ext_gdrive', label: 'Eksternal: Google Drive/Slides', icon: '☁️', aktif: true },
	{ key: 'ext_standard', label: 'Eksternal: Standar / Klien', icon: '📐', aktif: true },
	{ key: 'manual_hrd', label: 'Manual HRD', icon: '✍️', aktif: true }
];

const KEYS = DEFAULT_SUMBER.map((s) => s.key);
const clean = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

/** Gabungkan default dengan override admin (aman terhadap JSON rusak; kunci asing diabaikan). */
export function mergeSumberConfig(overrides: unknown): SumberDef[] {
	let o: any = overrides;
	if (typeof o === 'string') {
		try { o = JSON.parse(o); } catch { o = null; }
	}
	const map = o && typeof o === 'object' && !Array.isArray(o) ? o : {};
	return DEFAULT_SUMBER.map((d) => {
		const ov = map[d.key];
		if (!ov || typeof ov !== 'object') return { ...d };
		return { ...d, label: clean(ov.label, 60) || d.label, icon: clean(ov.icon, 8) || d.icon, aktif: ov.aktif === false || ov.aktif === 'false' ? false : d.aktif };
	});
}

/** Kunci sumber sebuah program (tanpa petunjuk modul — kode/tag/penanda pembuat sudah cukup untuk lapangan). */
export function detectSumberKey(p: { kode?: string | null; created_by?: string | null; judul?: string | null; deskripsi?: string | null } | null): string {
	if (!p) return 'manual_hrd';
	const tag = String(p.deskripsi ?? '').match(/\[Sumber:\s*([a-z0-9_]+)\]/i)?.[1]?.toLowerCase();
	if (tag && KEYS.includes(tag)) return tag;
	const kode = clean(p.kode, 80).toUpperCase();
	if (/^TRN-INV-(P|T)\d+/.test(kode) || kode === 'TRN-INV-UMUM') return 'inv360_item';
	if (/^TRN-SOP-/.test(kode) || p.created_by === 'sop-ai-draft') return 'sop_doc';
	if (/^TRN-ALUR-/.test(kode)) return 'process_flow';
	if (/^TRN-(NCR|FB)-/.test(kode)) return 'ncr_case';
	if (/^TRN-(P2H|MAINT)-/.test(kode)) return 'maint_p2h';
	if (/^TRN-(HSE|JSA|K3)-/.test(kode)) return 'hse_jsa';
	if (/^TRN-(RND|PRODUK)-/.test(kode)) return 'rnd_knowledge';
	if (p.created_by === 'ai-ingest' || /^AI-/.test(kode) || /\[Draft AI\]/i.test(String(p.judul ?? ''))) return 'ext_gdrive';
	return 'manual_hrd';
}

export function sumberOfProgram(p: Parameters<typeof detectSumberKey>[0], config: SumberDef[] = DEFAULT_SUMBER): SumberPelatihan {
	const key = detectSumberKey(p);
	const d = config.find((s) => s.key === key) ?? DEFAULT_SUMBER[DEFAULT_SUMBER.length - 1];
	return { key: d.key, label: d.label, icon: d.icon };
}

const CACHE_TTL_MS = 300_000;
let _cache: { at: number; value: SumberDef[] } | null = null;

/** Konfigurasi sumber aktif (cache 5 menit). Gagal baca → default + log jelas; katalog tetap tampil. */
export async function getSumberConfig(): Promise<SumberDef[]> {
	if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.value;
	let value = mergeSumberConfig(null);
	try {
		const res = await directusServerJson<{ data: Array<{ setting_value: unknown }> }>(
			'/items/app_settings?filter[module][_eq]=training_lms&filter[setting_key][_eq]=source_registry&fields=setting_value&limit=1'
		);
		value = mergeSumberConfig(res?.data?.[0]?.setting_value);
	} catch (err) {
		console.error('[trainingSource] gagal baca app_settings source_registry, pakai default:', err);
	}
	_cache = { at: Date.now(), value };
	return value;
}

export function clearSumberConfigCache(): void {
	_cache = null;
}
