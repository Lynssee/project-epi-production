// src/lib/server/sjTerimaSettings.ts
// Fase 5 Pengiriman Ekspedisi (15 Okt 2026) — setelan app_settings module='logistik'
// untuk wizard Terima Barang. Pola identik gerbangSj/settings.ts: default selalu di
// kode, cache in-memory 5 menit, komponen TIDAK query Directus sendiri.

import { directusServerJson } from './directus';

const TTL = 300_000;
let cache: { at: number; v: boolean } | null = null;

/** Langkah 3 (foto SJ fisik) di wizard Terima Barang wajib diisi (tidak bisa dilewati)? Default false. */
export async function getTerimaWajibScanFisik(): Promise<boolean> {
	if (cache && Date.now() - cache.at < TTL) return cache.v;
	let v = false;
	try {
		const res = await directusServerJson<{ data: { setting_value: unknown }[] }>(
			`/items/app_settings?filter[module][_eq]=logistik&filter[setting_key][_eq]=terima_wajib_scan_fisik&fields=setting_value&limit=1`
		);
		const raw = res?.data?.[0]?.setting_value;
		v = raw === true || ['true', '1'].includes(String(raw).toLowerCase());
	} catch (err) {
		console.error('[sjTerimaSettings] gagal baca app_settings module=logistik, pakai default false:', err);
	}
	cache = { at: Date.now(), v };
	return v;
}
