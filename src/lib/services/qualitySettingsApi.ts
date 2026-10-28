// src/lib/services/qualitySettingsApi.ts
// Quality Management Proyek v2, Fase 0 — pembaca read-only koleksi dedicated
// `project_quality_settings` (bukan namespace system_settings — lihat versi admin
// erp-epi-1/qualitySettingsApi.js). Sama pola cache 5 menit + gagal-lunak seperti projectSettings.ts.
// Lapangan TIDAK boleh menulis ke koleksi ini — edit hanya lewat panel Admin.

import { writable, get } from 'svelte/store';
import directus, { handleDirectusError } from './directus';
import { readItems } from '@directus/sdk';

const CACHE_TTL_MS = 5 * 60 * 1000;

export type QualitySettingsMap = Record<string, any>;

export const QUALITY_SETTINGS_DEFAULTS: QualitySettingsMap = {
	'project.quality.pass_rate_penalty_per_capa': 5,
	'scoring.weights': { pass_rate: 1, capa_penalty: 1 },
	'ncr.categories': ['coating_defect', 'surface_prep', 'material', 'workmanship', 'procedure', 'equipment'],
	'ncr.severity_config': { minor: { tenggat_hari: 14 }, major: { tenggat_hari: 7 }, critical: { tenggat_hari: 2 } },
	'alert.thresholds': { score_warning: 80, score_critical: 60 },
	'report.recipients': [],
	'rfi.lead_time_days': 2
};

export const qualitySettingsStore = writable<QualitySettingsMap>({ ...QUALITY_SETTINGS_DEFAULTS });

let cache: QualitySettingsMap | null = null;
let cachedAt = 0;
let inflight: Promise<QualitySettingsMap> | null = null;

/**
 * Muat setelan project_quality_settings dari Directus. Cache 5 menit, gagal-lunak ke default.
 * @param force - lewati cache
 */
export async function loadQualitySettings(force = false): Promise<QualitySettingsMap> {
	const now = Date.now();
	if (!force && cache && now - cachedAt < CACHE_TTL_MS) return cache;
	if (inflight) return inflight;

	inflight = (async () => {
		const merged: QualitySettingsMap = { ...QUALITY_SETTINGS_DEFAULTS };
		try {
			const rows = await directus.request(
				readItems('project_quality_settings' as any, { limit: -1 })
			);
			for (const row of rows as any[]) {
				if (!row.setting_key) continue;
				merged[row.setting_key] = row.setting_value ?? merged[row.setting_key];
			}
		} catch (err) {
			console.warn('[qualitySettings] Directus tak terjangkau — pakai default.', err);
			try {
				handleDirectusError(err);
			} catch {
				// sudah di-log di atas; tetap lanjut dengan default
			}
		}
		cache = merged;
		cachedAt = Date.now();
		qualitySettingsStore.set(merged);
		inflight = null;
		return merged;
	})();

	return inflight;
}

/** Baca satu kunci secara sinkron dari cache (atau default bila belum pernah dimuat). */
export function getQualitySetting(key: string): any {
	const source = cache || get(qualitySettingsStore) || QUALITY_SETTINGS_DEFAULTS;
	return key in source ? source[key] : QUALITY_SETTINGS_DEFAULTS[key];
}

/** Paksa muat ulang dari Directus. */
export function reloadQualitySettings(): Promise<QualitySettingsMap> {
	return loadQualitySettings(true);
}
