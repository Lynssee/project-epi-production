// src/lib/server/phoneDepositGate.ts
// Gerbang kepatuhan Deposit HP di clock-in — Fase 5, rencana Optimasi Inventory & Produksi +
// Deposit HP + Kiosk Produksi v2 (24 Agu 2026). Risiko #1 di seluruh dokumen: menyentuh absensi
// yang berdampak ke gaji. Default `phone_deposit.mode_gerbang` = "off" (lihat Fase 0 seed) --
// modul ini FAIL-OPEN total: kegagalan baca setelan/Directus TIDAK PERNAH memblokir absen,
// hanya melewatkan gerbang. HANYA memblokir kalau mode eksplisit "block" DAN divisi karyawan
// termasuk phone_deposit.divisi_wajib DAN belum ada baris phone_deposit_log hari ini.

import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';

type GateMode = 'off' | 'warn' | 'block';

interface PhoneDepositSettings {
	mode: GateMode;
	divisiWajib: string[];
}

const SETTINGS_CACHE_TTL_MS = 2 * 60 * 1000;
let settingsCache: { at: number; value: PhoneDepositSettings } | null = null;
let settingsInflight: Promise<PhoneDepositSettings> | null = null;

/** Untuk tes / invalidasi setelah admin mengubah setelan phone_deposit. */
export function clearPhoneDepositSettingsCache() {
	settingsCache = null;
	settingsInflight = null;
}

function parseSettingValue<T>(raw: unknown, fallback: T): T {
	if (raw === undefined || raw === null || raw === '') return fallback;
	if (typeof raw !== 'string') return raw as T;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return raw as T;
	}
}

async function loadPhoneDepositSettings(): Promise<PhoneDepositSettings> {
	const now = Date.now();
	if (settingsCache && now - settingsCache.at < SETTINGS_CACHE_TTL_MS) {
		return settingsCache.value;
	}
	if (settingsInflight) return settingsInflight;

	const pending = (async (): Promise<PhoneDepositSettings> => {
		const fallback: PhoneDepositSettings = { mode: 'off', divisiWajib: [] };
		try {
			const res = await directusServerJson<{ data: Array<{ setting_key: string; setting_value: unknown }> }>(
				'/items/system_settings?filter[setting_key][_in]=phone_deposit.mode_gerbang,phone_deposit.divisi_wajib&fields=setting_key,setting_value&limit=5'
			);
			const rows = res?.data || [];
			const modeRow = rows.find((r) => r.setting_key === 'phone_deposit.mode_gerbang');
			const divisiRow = rows.find((r) => r.setting_key === 'phone_deposit.divisi_wajib');
			const rawMode = parseSettingValue<string>(modeRow?.setting_value, 'off');
			const mode: GateMode = rawMode === 'block' || rawMode === 'warn' ? rawMode : 'off';
			const rawDivisi = parseSettingValue<unknown>(divisiRow?.setting_value, []);
			const divisiWajib = Array.isArray(rawDivisi) ? rawDivisi.map(String) : [];
			const value = { mode, divisiWajib };
			settingsCache = { at: Date.now(), value };
			return value;
		} catch {
			return fallback;
		}
	})().finally(() => {
		if (settingsInflight === pending) settingsInflight = null;
	});

	settingsInflight = pending;
	return pending;
}

export interface PhoneDepositGateResult {
	mode: GateMode;
	blocked: boolean;
	warned: boolean;
	message: string | null;
}

/** Panggil SETELAH tahu karyawan.divisi, SEBELUM menulis absensi_harian. Tidak pernah throw. */
export async function checkPhoneDepositGate(
	karyawanId: number | string,
	divisi: string | null
): Promise<PhoneDepositGateResult> {
	const noGate: PhoneDepositGateResult = { mode: 'off', blocked: false, warned: false, message: null };
	try {
		const { mode, divisiWajib } = await loadPhoneDepositSettings();
		if (mode === 'off') return noGate;

		if (!divisi || !divisiWajib.includes(divisi)) return { ...noGate, mode };

		const today = todayJakarta();
		const res = await directusServerJson<{ data: any[] }>(
			`/items/phone_deposit_log?filter[karyawan_id][_eq]=${karyawanId}&filter[tanggal][_eq]=${today}&filter[status][_in]=deposited,exempt&limit=1`
		);
		const sudahSetor = (res?.data || []).length > 0;
		if (sudahSetor) return { ...noGate, mode };

		const message = 'Anda belum tercatat setor HP hari ini. Setor HP ke satpam sebelum masuk area produksi.';
		if (mode === 'block') return { mode, blocked: true, warned: false, message };
		return { mode, blocked: false, warned: true, message }; // mode === 'warn'
	} catch (e) {
		console.warn('[phoneDepositGate] Gagal cek gerbang, dilewati (fail-open):', e);
		return noGate;
	}
}
