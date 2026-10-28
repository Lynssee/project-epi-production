// src/lib/services/manpowerSettings.ts
// Setelan namespace manpower.* (Akuntabilitas Pembayaran Manpower v3, §5.3).
// Sama polanya dengan projectSettings.ts — SATU sumber dengan admin (erp-epi-1)
// manpowerSettings.js, dibaca dari system_settings, bukan disalin manual.

import { writable, get } from 'svelte/store';
import directus from './directus';
import { readItems } from '@directus/sdk';

const NAMESPACE = 'manpower.';
const CACHE_TTL_MS = 5 * 60 * 1000;

export type ManpowerSettingsMap = Record<string, any>;

export const MANPOWER_SETTINGS_DEFAULTS: ManpowerSettingsMap = {
	'manpower.gate.verifikasi_enforce_from': '2026-11-01',
	'manpower.gate.dokumen_enforce_from': '2026-10-28',
	'manpower.gate.koridor_enforce_from': '2026-10-01',
	'manpower.gate.g12_enforce_from': '2026-09-15',
	'manpower.gate.severity': { G13: 'SEMI', G14: 'SEMI', G15: 'SEMI', G16: 'SEMI' },
	'manpower.payroll_keywords': ['upah', 'gaji', 'kasbon manpower', 'ongkos pekerja', 'borongan'],
	'manpower.tunai_pagu_harian': 2000000,
	'manpower.koridor.ambang_pengesahan_massal_pct': 10,
	// FASE 6 (Self-Service PL v2, K4): pekerja baru daftar-lapangan boleh diabsen
	// N HARI KERJA sebelum SPK disetujui; lewat itu absensi dari layar regu terkunci.
	'manpower.masa_sementara_hari': 3,
	// SPK borongan paralel: pekerja borongan boleh pegang >1 SPK aktif di proyek BERBEDA
	// dengan rentang tanggal tumpang tindih (dibayar per hasil, bukan per hari).
	'manpower.spk.izin_overlap_borongan': true,
	// SPK harian multi-proyek: pekerja harian (HSE, pengawas, teknisi mobile) boleh pegang >1 SPK aktif lintas proyek.
	'manpower.spk.izin_overlap_harian': true,
	// Mode penanganan bentrok SPK: 'warn' (peringatan, tidak memblokir) atau 'block' (blokir)
	'manpower.spk.overlap_mode': 'warn',
	// Fase 3 — ketat-nya geo-fence absensi per konteks: wajib | longgar | off.
	'manpower.geofence.project': 'wajib',
	'manpower.geofence.maintenance': 'wajib',
	'manpower.geofence.csr': 'longgar',
	'manpower.geofence.internal': 'longgar'
};

export const manpowerSettingsStore = writable<ManpowerSettingsMap>({ ...MANPOWER_SETTINGS_DEFAULTS });

let cache: ManpowerSettingsMap | null = null;
let cachedAt = 0;
let inflight: Promise<ManpowerSettingsMap> | null = null;

function parseValue(setting_type: string, raw: string | null | undefined, fallback: any): any {
	if (raw == null) return fallback;
	try {
		switch (setting_type) {
			case 'number':
				return Number(JSON.parse(raw));
			case 'boolean':
				return Boolean(JSON.parse(raw));
			case 'json':
			case 'list':
			case 'enum':
				return JSON.parse(raw);
			default:
				try {
					return JSON.parse(raw);
				} catch {
					return raw;
				}
		}
	} catch (err) {
		console.warn(`[manpowerSettings] Gagal parse "${raw}", pakai default.`, err);
		return fallback;
	}
}

export async function loadManpowerSettings(force = false): Promise<ManpowerSettingsMap> {
	const now = Date.now();
	if (!force && cache && now - cachedAt < CACHE_TTL_MS) return cache;
	if (inflight) return inflight;

	inflight = (async () => {
		const merged: ManpowerSettingsMap = { ...MANPOWER_SETTINGS_DEFAULTS };
		try {
			// 1. system_settings
			const rows = await directus.request(
				readItems('system_settings' as any, {
					filter: { setting_key: { _starts_with: NAMESPACE } } as any,
					limit: -1
				})
			);
			for (const row of rows as any[]) {
				const key = row.setting_key;
				if (!(key in merged)) continue;
				merged[key] = parseValue(row.setting_type, row.setting_value, MANPOWER_SETTINGS_DEFAULTS[key]);
			}

			// 2. app_settings (module=manpower)
			const appRows = await directus.request(
				readItems('app_settings' as any, {
					filter: { module: { _eq: 'manpower' } } as any,
					limit: -1
				})
			).catch(() => []);
			for (const r of (appRows as any[]) || []) {
				const val = parseValue(r.setting_type, r.setting_value, null);
				if (val === null || val === undefined) continue;
				if (r.setting_key === 'spk_izin_overlap_borongan') merged['manpower.spk.izin_overlap_borongan'] = Boolean(val);
				if (r.setting_key === 'spk_izin_overlap_harian') merged['manpower.spk.izin_overlap_harian'] = Boolean(val);
				if (r.setting_key === 'spk_overlap_mode') merged['manpower.spk.overlap_mode'] = String(val);
				if (r.setting_key.startsWith('manpower.')) merged[r.setting_key] = val;
			}
		} catch (err) {
			console.warn('[manpowerSettings] Directus tak terjangkau — pakai default.', err);
		}
		cache = merged;
		cachedAt = Date.now();
		manpowerSettingsStore.set(merged);
		inflight = null;
		return merged;
	})();

	return inflight;
}

/** Baca satu kunci secara sinkron dari cache (atau default bila belum pernah dimuat). */
export function getManpowerSetting(key: string): any {
	const source = cache || get(manpowerSettingsStore) || MANPOWER_SETTINGS_DEFAULTS;
	return key in source ? source[key] : MANPOWER_SETTINGS_DEFAULTS[key];
}

export function getAllManpowerSettings(): ManpowerSettingsMap {
	return cache ? { ...cache } : { ...MANPOWER_SETTINGS_DEFAULTS };
}

export function reloadManpowerSettings(): Promise<ManpowerSettingsMap> {
	return loadManpowerSettings(true);
}
