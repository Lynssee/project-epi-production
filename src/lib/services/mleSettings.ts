// src/lib/services/mleSettings.ts
// Modul pembaca system_settings namespace mle.* (Material, Logistik & Equipment — Rencana
// Final 7 Agu 2026, Fase 0). Reader kembar ringan dari erp-epi-1/src/lib/services/mleSettings.js
// (dua deployment terpisah, tidak bisa saling import) — read-only di sini, CRUD tetap di admin
// lewat /settings/material-logistik-equipment. Sama pola dengan inventorySettings.ts.

import { writable, get } from 'svelte/store';
import directus, { handleDirectusError } from './directus';
import { readItems } from '@directus/sdk';

const NAMESPACE = 'mle.';
const CACHE_TTL_MS = 5 * 60 * 1000;

export type MleSettingsMap = Record<string, any>;

// Sama persis dengan erp-epi-1/src/lib/services/mleSettings.js (MLE_SETTINGS_DEFAULTS) —
// kedua dashboard baca kunci yang sama dari koleksi system_settings yang sama.
export const MLE_SETTINGS_DEFAULTS: MleSettingsMap = {
	'mle.material.categories': ['consumable', 'sewa_alat', 'safety', 'supplier', 'spare_part'],
	'mle.material.units': ['kg', 'm', 'm2', 'pcs', 'lot', 'liter', 'roll', 'set'],
	'mle.material.low_stock_default_pct': 20,
	'mle.material.require_photo_konsumsi': false,
	'mle.material.approval_levels': ['PL', 'PM', 'Procurement'],
	'mle.logistik.delivery_statuses': ['preparing', 'shipped', 'in_transit', 'delivered', 'confirmed'],
	'mle.logistik.gr_toleransi_pct': 0,
	'mle.logistik.gr_reminder_days': 3,
	'mle.logistik.return_reasons': ['rusak', 'salah_kirim', 'kelebihan', 'tidak_sesuai_spec'],
	'mle.equipment.types': ['excavator', 'compressor', 'genset', 'pump', 'vehicle', 'tool'],
	'mle.equipment.conditions': ['baik', 'perlu_servis', 'rusak', 'under_maintenance'],
	'mle.equipment.idle_alert_days': 5,
	'mle.equipment.p2h_auto_wo': true,
	'mle.urgency_levels': ['normal', 'urgent', 'kritis'],
	'mle.ownership.types': ['eltama', 'subcon', 'customer', 'sewa_vendor'],
	'mle.ownership.subcon_require_initial_photo': true,
	'mle.ownership.subcon_equipment_require_p2h': true,
	'mle.ownership.allow_non_catalog_subcon_items': true,
	'mle.ownership.block_subcon_return_to_eltama': true
};

/** Store reaktif untuk komponen Svelte — selalu berisi default + override, tidak pernah kosong. */
export const mleSettingsStore = writable<MleSettingsMap>({ ...MLE_SETTINGS_DEFAULTS });

let cache: MleSettingsMap | null = null;
let cachedAt = 0;
let inflight: Promise<MleSettingsMap> | null = null;

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
		console.warn(`[mleSettings] Gagal parse "${raw}", pakai default.`, err);
		return fallback;
	}
}

/**
 * Muat setelan mle.* dari Directus. Aman dipanggil berkali-kali — di-cache 5 menit
 * dan gagal-lunak ke default bila Directus tak terjangkau.
 * @param force - lewati cache (dipakai tombol "muat ulang setelan")
 */
export async function loadMleSettings(force = false): Promise<MleSettingsMap> {
	const now = Date.now();
	if (!force && cache && now - cachedAt < CACHE_TTL_MS) return cache;
	if (inflight) return inflight;

	inflight = (async () => {
		const merged: MleSettingsMap = { ...MLE_SETTINGS_DEFAULTS };
		try {
			const rows = await directus.request(
				readItems('system_settings' as any, {
					filter: { setting_key: { _starts_with: NAMESPACE } } as any,
					limit: -1
				})
			);
			for (const row of rows as any[]) {
				const key = row.setting_key;
				if (!(key in merged)) continue;
				merged[key] = parseValue(row.setting_type, row.setting_value, MLE_SETTINGS_DEFAULTS[key]);
			}
		} catch (err) {
			console.warn('[mleSettings] Directus tak terjangkau — pakai default.', err);
			try {
				handleDirectusError(err);
			} catch {
				// sudah di-log di atas; tetap lanjut dengan default
			}
		}
		cache = merged;
		cachedAt = Date.now();
		mleSettingsStore.set(merged);
		inflight = null;
		return merged;
	})();

	return inflight;
}

/** Baca satu kunci secara sinkron dari cache (atau default bila belum pernah dimuat). */
export function getMleSetting(key: string): any {
	const source = cache || get(mleSettingsStore) || MLE_SETTINGS_DEFAULTS;
	return key in source ? source[key] : MLE_SETTINGS_DEFAULTS[key];
}

/** Baca seluruh setelan mle.* secara sinkron (default + override yang sudah dimuat). */
export function getAllMleSettings(): MleSettingsMap {
	return cache ? { ...cache } : { ...MLE_SETTINGS_DEFAULTS };
}

/** Paksa muat ulang dari Directus. */
export function reloadMleSettings(): Promise<MleSettingsMap> {
	return loadMleSettings(true);
}
