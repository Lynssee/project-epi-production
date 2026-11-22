// src/routes/api/process-guidance/flows/fieldHierarchyConfig.ts
// Pembaca konfigurasi Lampiran G & label hirarki (app_settings module='process_guidance', setting_key='sop_hierarchy_annex_config')
// untuk aplikasi lapangan. Cache in-memory 5 menit + single-flight; gagal baca Directus memakai bawaan (fail-soft).

import { directusServerJson } from '$lib/server/directus';

export interface FieldHierarchyConfig {
	labelMaster: string;
	labelInduk: string;
	labelTurunan: string;
	defaultIncludeDraftApproval: boolean;
}

export const DEFAULT_FIELD_HIERARCHY_CONFIG: FieldHierarchyConfig = {
	labelMaster: 'MASTER SOP',
	labelInduk: 'SOP INDUK',
	labelTurunan: 'ANAK KERJA / IK',
	defaultIncludeDraftApproval: true
};

export const FIELD_HIERARCHY_CACHE_TTL_MS = 5 * 60 * 1000;

let cached: { at: number; config: FieldHierarchyConfig } | null = null;
let inflight: Promise<FieldHierarchyConfig> | null = null;

export function clearFieldHierarchyConfigCache(): void {
	cached = null;
	inflight = null;
}

function cleanLabel(val: unknown, fallback: string): string {
	const s = typeof val === 'string' ? val.trim().slice(0, 40) : '';
	return s || fallback;
}

export function sanitizeFieldHierarchyConfig(raw: unknown): FieldHierarchyConfig {
	let obj = raw;
	if (typeof obj === 'string') {
		try {
			obj = JSON.parse(obj);
		} catch {
			obj = null;
		}
	}
	const src = obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : {};
	return {
		labelMaster: cleanLabel(src.labelMaster, DEFAULT_FIELD_HIERARCHY_CONFIG.labelMaster),
		labelInduk: cleanLabel(src.labelInduk, DEFAULT_FIELD_HIERARCHY_CONFIG.labelInduk),
		labelTurunan: cleanLabel(src.labelTurunan, DEFAULT_FIELD_HIERARCHY_CONFIG.labelTurunan),
		defaultIncludeDraftApproval:
			typeof src.defaultIncludeDraftApproval === 'boolean'
				? src.defaultIncludeDraftApproval
				: DEFAULT_FIELD_HIERARCHY_CONFIG.defaultIncludeDraftApproval
	};
}

export async function loadFieldHierarchyConfig(now = Date.now()): Promise<FieldHierarchyConfig> {
	if (cached && now - cached.at < FIELD_HIERARCHY_CACHE_TTL_MS) {
		return cached.config;
	}
	if (inflight) return inflight;

	const path =
		'/items/app_settings?filter[module][_eq]=process_guidance&filter[setting_key][_eq]=sop_hierarchy_annex_config&fields=setting_value&limit=1';
	inflight = directusServerJson<{ data?: { setting_value?: unknown }[] }>(path)
		.then((res) => {
			const row = Array.isArray(res?.data) ? res.data[0] : null;
			const cfg = sanitizeFieldHierarchyConfig(row?.setting_value);
			cached = { at: now, config: cfg };
			return cfg;
		})
		.catch((e) => {
			console.warn('[fieldHierarchyConfig] gagal baca app_settings, pakai bawaan:', e instanceof Error ? e.message : e);
			return { ...DEFAULT_FIELD_HIERARCHY_CONFIG };
		})
		.finally(() => {
			inflight = null;
		});

	return inflight;
}
