// src/lib/server/gerbangSj/settings.ts
// GSP-03/04 — setelan Gerbang SJ dari app_settings module='logistik' (bukan system_settings).
// Default selalu ada di kode; cache in-memory 5 menit. Komponen TIDAK query Directus sendiri.

import { directusServerJson } from '../directus';

export type GerbangSettings = {
	/** batas "terlambat" di antrian, menit (key: gerbang_sla_menit) */
	slaMenit: number;
	/** K1=A: cek per item wajib di semua layar (key: gerbang_item_wajib) */
	itemWajib: boolean;
	/** SJ-09 opsi C: antrean gerbang untuk SJ penjualan (key: gerbang_penjualan_aktif; default MATI) */
	penjualanAktif: boolean;
	/** Wajib ambil foto muatan/kendaraan di gerbang sebelum meloloskan (key: gerbang_foto_wajib; default true) */
	fotoWajib: boolean;
	/** RSM-08: SJ 'created' yang sudah dicetak tapi tidak discan muat tetap tampil di antrean selama N hari terakhir (0 = nonaktif; key: gerbang_created_window_hari) */
	createdWindowHari: number;
};

export const GERBANG_DEFAULTS: GerbangSettings = { slaMenit: 120, itemWajib: true, penjualanAktif: false, fotoWajib: true, createdWindowHari: 2 };

const TTL = 300_000;
let cache: { at: number; v: GerbangSettings } | null = null;

export function parseGerbangSettings(rows: { setting_key: string; setting_value: unknown }[]): GerbangSettings {
	const v = { ...GERBANG_DEFAULTS };
	for (const r of rows) {
		if (r.setting_key === 'gerbang_sla_menit') {
			const n = Number(r.setting_value);
			if (Number.isFinite(n) && n > 0) v.slaMenit = Math.round(n);
		} else if (r.setting_key === 'gerbang_created_window_hari') {
			const n = Number(r.setting_value);
			if (Number.isFinite(n) && n >= 0) v.createdWindowHari = Math.round(n);
		} else if (r.setting_key === 'gerbang_penjualan_aktif') {
			v.penjualanAktif = ['true', '1'].includes(String(r.setting_value).toLowerCase());
		} else if (r.setting_key === 'gerbang_item_wajib') {
			const s = String(r.setting_value).toLowerCase();
			if (['true', '1'].includes(s)) v.itemWajib = true;
			else if (['false', '0'].includes(s)) v.itemWajib = false;
		} else if (r.setting_key === 'gerbang_foto_wajib') {
			const s = String(r.setting_value).toLowerCase();
			if (['false', '0'].includes(s)) v.fotoWajib = false;
			else if (['true', '1'].includes(s)) v.fotoWajib = true;
		}
	}
	return v;
}

export async function getGerbangSettings(): Promise<GerbangSettings> {
	if (cache && Date.now() - cache.at < TTL) return cache.v;
	let v = { ...GERBANG_DEFAULTS };
	try {
		const res = await directusServerJson<{ data: { setting_key: string; setting_value: unknown }[] }>(
			`/items/app_settings?filter[module][_eq]=logistik&filter[setting_key][_in]=gerbang_sla_menit,gerbang_item_wajib,gerbang_penjualan_aktif,gerbang_foto_wajib,gerbang_created_window_hari&fields=setting_key,setting_value&limit=-1`
		);
		v = parseGerbangSettings(res?.data || []);
	} catch (err) {
		console.error('[gerbangSj/settings] gagal baca app_settings module=logistik, pakai default:', err);
	}
	cache = { at: Date.now(), v };
	return v;
}
