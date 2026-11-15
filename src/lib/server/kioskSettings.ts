// src/lib/server/kioskSettings.ts
// Setelan kiosk dari system_settings: SATU query `_in` untuk semua key + cache memori singkat.
// Dulu layout kiosk menembak 3 query terpisah di setiap pindah halaman, dan /api/kiosk/home
// membaca ulang key yang sama. Setelan ini jarang berubah (diatur admin lewat UI), jadi cache
// 60 detik cukup: perubahan admin tetap terasa dalam ±1 menit tanpa restart server.

import { directusServerJson } from '$lib/server/directus';

export const KIOSK_SETTING_KEYS = [
	'kiosk.session_timeout_minutes',
	'kiosk.enabled',
	'kiosk.session_timeout_per_menu'
] as const;

const TTL_MS = 60 * 1000;

type RawMap = Map<string, string | null>;

let cache: { at: number; map: RawMap } | null = null;
// Dedup permintaan bersamaan (mis. beberapa kiosk login di detik yang sama) → tetap 1 query.
let inflight: Promise<RawMap> | null = null;

async function fetchAll(): Promise<RawMap> {
	const keys = KIOSK_SETTING_KEYS.map(encodeURIComponent).join(',');
	const res = await directusServerJson<{ data: { setting_key: string; setting_value: string | null }[] }>(
		`/items/system_settings?filter[setting_key][_in]=${keys}&fields=setting_key,setting_value&limit=${KIOSK_SETTING_KEYS.length}`
	);
	const map: RawMap = new Map();
	for (const row of res?.data || []) map.set(row.setting_key, row.setting_value ?? null);
	return map;
}

/**
 * Nilai mentah per key. Gagal baca → Map kosong (pemanggil memakai default masing-masing),
 * dan kegagalan TIDAK di-cache supaya request berikutnya mencoba lagi.
 */
async function readRaw(): Promise<RawMap> {
	if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
	if (!inflight) {
		inflight = fetchAll()
			.then((map) => {
				cache = { at: Date.now(), map };
				return map;
			})
			.catch((e) => {
				console.warn('[kioskSettings] gagal membaca system_settings, pakai default:', e?.message || e);
				return new Map() as RawMap;
			})
			.finally(() => {
				inflight = null;
			});
	}
	return inflight;
}

function parseJson(raw: string | null | undefined): unknown {
	if (raw === undefined || raw === null || raw === '') return undefined;
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

export interface KioskSettings {
	timeoutMinutes: number;
	kioskEnabled: boolean;
	timeoutPerMenu: Record<string, number>;
}

/** Aturan default IDENTIK dengan versi lama di kiosk/+layout.server.ts (lihat komentar di sana). */
export async function readKioskSettings(): Promise<KioskSettings> {
	const map = await readRaw();

	const t = Number(parseJson(map.get('kiosk.session_timeout_minutes')));
	const timeoutMinutes = Number.isFinite(t) && t > 0 ? t : 5;

	// Fail-open: hanya berhenti bila nilainya eksplisit `false`.
	const enabledRaw = parseJson(map.get('kiosk.enabled'));
	const kioskEnabled = enabledRaw === undefined ? true : enabledRaw !== false;

	const perMenuRaw = parseJson(map.get('kiosk.session_timeout_per_menu'));
	const timeoutPerMenu =
		perMenuRaw && typeof perMenuRaw === 'object' && !Array.isArray(perMenuRaw)
			? (perMenuRaw as Record<string, number>)
			: {};

	return { timeoutMinutes, kioskEnabled, timeoutPerMenu };
}

/** Hanya untuk test. */
export function _resetKioskSettingsCache() {
	cache = null;
	inflight = null;
}
