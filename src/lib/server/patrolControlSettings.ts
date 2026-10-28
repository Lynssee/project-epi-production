// src/lib/server/patrolControlSettings.ts
// Pembaca setelan "Pertajam Kontrol Patroli" — app_settings module='patrol_control'
// (dua sistem settings terpisah: ini pakai app_settings, BUKAN system_settings).
// Default selalu ada di kode; cache in-memory 5 menit. Komponen TIDAK query Directus
// sendiri untuk setelan ini — harus lewat modul ini.

import { directusServerJson } from './directus';

export type ManualInputMode = 'disabled' | 'supervisor_override' | 'enabled';
export type GpsEnforcementMode = 'hard' | 'soft' | 'off';
export type GateMode = 'shadow' | 'soft' | 'hard';

export interface PatrolControlSettings {
	/** disabled = tidak pernah bisa input manual. supervisor_override = wajib tahan 3 detik + alasan. enabled = bebas seperti dulu. */
	manualInputMode: ManualInputMode;
	/** Boleh unggah foto dari galeri (selain kamera langsung)? */
	galleryUploadEnabled: boolean;
	/** hard = tolak scan tanpa GPS valid dalam radius. soft = tetap lolos, tandai in_radius=false + alert. off = perilaku lama. */
	gpsEnforcement: GpsEnforcementMode;
	/** Jeda minimal (detik) antar scan checkpoint — anti-speedrun. */
	minIntervalSeconds: number;
	/** Durasi minimal (menit) sebelum ronda bisa diselesaikan. */
	minPatrolDurationMinutes: number;
	/** Mode wajib cek kelengkapan ruangan untuk checkpoint kebersihan yang punya barang terdaftar. */
	wajibCekRuanganMode: GateMode;
	/** Durasi kerja minimal (menit) Two-Tap kebersihan (Fase 2) sebelum Tap 2 (Selesai Kerja) bisa dikirim tanpa alasan. */
	minDwellMinutes: number;
	/** Ambang skor checklist (%) — di bawah ini dianggap gagal untuk gerbang hold procurement.
	 *  Mode gate hold procurement/P2H sendiri dibaca dari gate_definitions (lihat gateDefinitionsMode.ts, Fase 4.3) — bukan dari sini. */
	failedChecklistThreshold: number;
	/** Ambang skor kepatuhan ronda (%) — di bawah ini memicu alert n8n/WA (Fase 4.2). */
	patrolLowComplianceThreshold: number;
	/** G_CLN2: item checklist kebersihan dijawab "Tidak" wajib punya foto bukti. */
	clnFotoWajibItemNo: boolean;
	/** G_CLN2: semua item template checklist kebersihan wajib dijawab. */
	clnWajibSemuaItem: boolean;
	/** G_SEC7: panjang minimal catatan serah-terima shift satpam (karakter). 0 = tidak dievaluasi. */
	secHandoverMinCatatan: number;
	/** G_SEC7: satpam yang menyerahkan wajib punya ronda selesai di tanggal itu (jejak logbook). */
	secHandoverWajibRonda: boolean;
	/** G_SEC2: jam kerja mulai (jam WIB 0-23) — keluar pribadi di jendela ini wajib izin jam-jaman. */
	secJamKerjaMulai: number;
	/** G_SEC2: jam kerja selesai (jam WIB 1-24, eksklusif). */
	secJamKerjaSelesai: number;
	/** G_SEC2: karyawan keluar keperluan pribadi pada jam kerja wajib punya izin jam-jaman aktif. */
	secWajibIzinPribadi: boolean;
}

export const PATROL_CONTROL_DEFAULTS: PatrolControlSettings = {
	manualInputMode: 'supervisor_override',
	galleryUploadEnabled: false,
	gpsEnforcement: 'soft',
	minIntervalSeconds: 60,
	minPatrolDurationMinutes: 10,
	wajibCekRuanganMode: 'soft',
	minDwellMinutes: 10,
	failedChecklistThreshold: 70,
	patrolLowComplianceThreshold: 70,
	clnFotoWajibItemNo: true,
	clnWajibSemuaItem: true,
	secHandoverMinCatatan: 20,
	secHandoverWajibRonda: true,
	secJamKerjaMulai: 8,
	secJamKerjaSelesai: 17,
	secWajibIzinPribadi: true
};

const CACHE_TTL_MS = 300_000;
let _cache: { at: number; value: PatrolControlSettings } | null = null;

function asBool(v: unknown, fallback: boolean): boolean {
	if (v === true || v === 'true' || v === '1' || v === 1) return true;
	if (v === false || v === 'false' || v === '0' || v === 0) return false;
	return fallback;
}

function asEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
	return allowed.includes(v as T) ? (v as T) : fallback;
}

function asPositiveInt(v: unknown, fallback: number): number {
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

/** Baca setelan patrol_control (cache 5 menit). Selalu mengembalikan objek lengkap. */
export async function getPatrolControlSettings(): Promise<PatrolControlSettings> {
	if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.value;
	const value: PatrolControlSettings = { ...PATROL_CONTROL_DEFAULTS };
	try {
		const res = await directusServerJson<{ data: Array<{ setting_key: string; setting_value: string }> }>(
			`/items/app_settings?filter[module][_eq]=patrol_control&fields=setting_key,setting_value&limit=-1`
		);
		for (const row of res?.data || []) {
			switch (row.setting_key) {
				case 'manual_input_mode':
					value.manualInputMode = asEnum(row.setting_value, ['disabled', 'supervisor_override', 'enabled'] as const, PATROL_CONTROL_DEFAULTS.manualInputMode);
					break;
				case 'gallery_upload':
					value.galleryUploadEnabled = asBool(row.setting_value, PATROL_CONTROL_DEFAULTS.galleryUploadEnabled);
					break;
				case 'gps_enforcement':
					value.gpsEnforcement = asEnum(row.setting_value, ['hard', 'soft', 'off'] as const, PATROL_CONTROL_DEFAULTS.gpsEnforcement);
					break;
				case 'min_interval_seconds':
					value.minIntervalSeconds = asPositiveInt(row.setting_value, PATROL_CONTROL_DEFAULTS.minIntervalSeconds);
					break;
				case 'default_min_patrol_minutes':
					value.minPatrolDurationMinutes = asPositiveInt(row.setting_value, PATROL_CONTROL_DEFAULTS.minPatrolDurationMinutes);
					break;
				case 'wajib_cek_ruangan_mode':
					value.wajibCekRuanganMode = asEnum(row.setting_value, ['shadow', 'soft', 'hard'] as const, PATROL_CONTROL_DEFAULTS.wajibCekRuanganMode);
					break;
				case 'default_min_dwell_minutes':
					value.minDwellMinutes = asPositiveInt(row.setting_value, PATROL_CONTROL_DEFAULTS.minDwellMinutes);
					break;
				case 'failed_checklist_threshold':
					value.failedChecklistThreshold = asPositiveInt(row.setting_value, PATROL_CONTROL_DEFAULTS.failedChecklistThreshold);
					break;
				case 'patrol_low_compliance_threshold':
					value.patrolLowComplianceThreshold = asPositiveInt(row.setting_value, PATROL_CONTROL_DEFAULTS.patrolLowComplianceThreshold);
					break;
				case 'cln_foto_wajib_item_no':
					value.clnFotoWajibItemNo = asBool(row.setting_value, PATROL_CONTROL_DEFAULTS.clnFotoWajibItemNo);
					break;
				case 'sec_handover_min_catatan': {
					const n = Number(row.setting_value);
					value.secHandoverMinCatatan = Number.isFinite(n) && n >= 0 ? Math.round(n) : PATROL_CONTROL_DEFAULTS.secHandoverMinCatatan;
					break;
				}
				case 'sec_jam_kerja_mulai': {
					const n = Number(row.setting_value);
					value.secJamKerjaMulai = Number.isInteger(n) && n >= 0 && n <= 23 ? n : PATROL_CONTROL_DEFAULTS.secJamKerjaMulai;
					break;
				}
				case 'sec_jam_kerja_selesai': {
					const n = Number(row.setting_value);
					value.secJamKerjaSelesai = Number.isInteger(n) && n >= 1 && n <= 24 ? n : PATROL_CONTROL_DEFAULTS.secJamKerjaSelesai;
					break;
				}
				case 'sec_wajib_izin_pribadi':
					value.secWajibIzinPribadi = asBool(row.setting_value, PATROL_CONTROL_DEFAULTS.secWajibIzinPribadi);
					break;
				case 'sec_handover_wajib_ronda':
					value.secHandoverWajibRonda = asBool(row.setting_value, PATROL_CONTROL_DEFAULTS.secHandoverWajibRonda);
					break;
				case 'cln_wajib_semua_item':
					value.clnWajibSemuaItem = asBool(row.setting_value, PATROL_CONTROL_DEFAULTS.clnWajibSemuaItem);
					break;
			}
		}
	} catch (err) {
		// Aturan #1: jangan telan diam-diam. Pakai default, tapi catat.
		console.error('[patrolControlSettings] gagal baca app_settings module=patrol_control, pakai default:', err);
	}
	_cache = { at: Date.now(), value };
	return value;
}

/** Untuk test / setelah admin ubah setelan. */
export function clearPatrolControlSettingsCache(): void {
	_cache = null;
}
