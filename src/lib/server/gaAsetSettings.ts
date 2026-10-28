// src/lib/server/gaAsetSettings.ts
// Pembaca setelan "Barang per Ruangan via QR Patroli" — app_settings module='ga_aset'
// (dua sistem settings terpisah: ini pakai app_settings, BUKAN system_settings).
// Default selalu ada di kode; cache in-memory 5 menit (dipanggil per resolve scan).
// Komponen TIDAK query Directus sendiri untuk setelan ini — harus lewat modul ini.

import { directusServerJson } from './directus';

export type ScanRouteMode = 'auto' | 'pilih' | 'checklist_dulu';
export type PengingatCekMode = 'off' | 'shadow' | 'soft';
export type VisibilitasNilai = 'off' | 'hr_superadmin' | 'semua';

export interface GaAsetSettings {
	/** auto = petugas terjadwal -> checklist, lainnya -> Halaman Ruangan. */
	scanRouteMode: ScanRouteMode;
	/** Tampilkan chip "Barang (N)" di header checklist OB. */
	chipBarangDiChecklist: boolean;
	/** Batas umur (hari) sejak cek terakhir sebelum ruangan "perlu dicek". */
	intervalCekHari: number;
	/** off | shadow (dashboard admin saja) | soft (banner di checklist, tidak memblokir). */
	modePengingatCek: PengingatCekMode;
	/** false = wajib pilih dari identitas_barang (keputusan Lead 10 Sep 2026). */
	izinkanBarangTanpaKatalog: boolean;
	/** Siapa boleh lihat nilai rupiah di HP lapangan. */
	visibilitasNilaiLapangan: VisibilitasNilai;
	/** true = laporan rusak langsung ubah qty_rusak tanpa konfirmasi admin. */
	autoKonfirmasiLaporRusak: boolean;
	/** Digest mingguan via n8n. */
	digestAktif: boolean;
}

export const GA_ASET_DEFAULTS: GaAsetSettings = {
	scanRouteMode: 'auto',
	chipBarangDiChecklist: true,
	intervalCekHari: 30,
	modePengingatCek: 'shadow',
	izinkanBarangTanpaKatalog: false,
	visibilitasNilaiLapangan: 'hr_superadmin',
	autoKonfirmasiLaporRusak: false,
	digestAktif: false
};

const CACHE_TTL_MS = 300_000;
let _cache: { at: number; value: GaAsetSettings } | null = null;

function asBool(v: unknown, fallback: boolean): boolean {
	if (v === true || v === 'true' || v === '1' || v === 1) return true;
	if (v === false || v === 'false' || v === '0' || v === 0) return false;
	return fallback;
}

function asEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
	return allowed.includes(v as T) ? (v as T) : fallback;
}

/** Baca setelan ga_aset (cache 5 menit). Selalu mengembalikan objek lengkap. */
export async function getGaAsetSettings(): Promise<GaAsetSettings> {
	if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.value;
	const value: GaAsetSettings = { ...GA_ASET_DEFAULTS };
	try {
		const res = await directusServerJson<{ data: Array<{ setting_key: string; setting_value: string }> }>(
			`/items/app_settings?filter[module][_eq]=ga_aset&fields=setting_key,setting_value&limit=-1`
		);
		for (const row of res?.data || []) {
			switch (row.setting_key) {
				case 'scan_route_mode':
					value.scanRouteMode = asEnum(row.setting_value, ['auto', 'pilih', 'checklist_dulu'] as const, GA_ASET_DEFAULTS.scanRouteMode);
					break;
				case 'chip_barang_di_checklist':
					value.chipBarangDiChecklist = asBool(row.setting_value, GA_ASET_DEFAULTS.chipBarangDiChecklist);
					break;
				case 'interval_cek_hari': {
					const n = Number(row.setting_value);
					if (Number.isFinite(n) && n > 0) value.intervalCekHari = Math.round(n);
					break;
				}
				case 'mode_pengingat_cek':
					value.modePengingatCek = asEnum(row.setting_value, ['off', 'shadow', 'soft'] as const, GA_ASET_DEFAULTS.modePengingatCek);
					break;
				case 'izinkan_barang_tanpa_katalog':
					value.izinkanBarangTanpaKatalog = asBool(row.setting_value, GA_ASET_DEFAULTS.izinkanBarangTanpaKatalog);
					break;
				case 'visibilitas_nilai_lapangan':
					value.visibilitasNilaiLapangan = asEnum(row.setting_value, ['off', 'hr_superadmin', 'semua'] as const, GA_ASET_DEFAULTS.visibilitasNilaiLapangan);
					break;
				case 'auto_konfirmasi_lapor_rusak':
					value.autoKonfirmasiLaporRusak = asBool(row.setting_value, GA_ASET_DEFAULTS.autoKonfirmasiLaporRusak);
					break;
				case 'digest_aktif':
					value.digestAktif = asBool(row.setting_value, GA_ASET_DEFAULTS.digestAktif);
					break;
			}
		}
	} catch (err) {
		// Aturan #1: jangan telan diam-diam. Pakai default, tapi catat.
		console.error('[gaAsetSettings] gagal baca app_settings module=ga_aset, pakai default:', err);
	}
	_cache = { at: Date.now(), value };
	return value;
}

/** Untuk test / setelah admin ubah setelan. */
export function clearGaAsetSettingsCache(): void {
	_cache = null;
}
