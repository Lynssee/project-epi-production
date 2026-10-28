// src/lib/server/phoneDepositGate.ts
// Gerbang kepatuhan Deposit HP di clock-in — Fase 5, rencana Optimasi Inventory & Produksi +
// Deposit HP + Kiosk Produksi v2 (24 Agu 2026). Risiko #1 di seluruh dokumen: menyentuh absensi
// yang berdampak ke gaji. Default `phone_deposit.mode_gerbang` = "off" (lihat Fase 0 seed) --
// modul ini FAIL-OPEN total: kegagalan baca setelan/Directus TIDAK PERNAH memblokir absen,
// hanya melewatkan gerbang. HANYA memblokir kalau mode eksplisit "block" DAN divisi karyawan
// termasuk phone_deposit.divisi_wajib DAN belum ada baris phone_deposit_log hari ini.

import { directusServerJson } from '$lib/server/directus';

type GateMode = 'off' | 'warn' | 'block';

async function readSetting<T>(key: string, fallback: T): Promise<T> {
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/system_settings?filter[setting_key][_eq]=${encodeURIComponent(key)}&limit=1`
		);
		const raw = res?.data?.[0]?.setting_value;
		if (raw === undefined || raw === null || raw === '') return fallback;
		try {
			return JSON.parse(raw) as T;
		} catch {
			return raw as T;
		}
	} catch {
		return fallback;
	}
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
		const mode = await readSetting<GateMode>('phone_deposit.mode_gerbang', 'off');
		if (mode === 'off') return noGate;

		const divisiWajib = await readSetting<string[]>('phone_deposit.divisi_wajib', []);
		if (!divisi || !divisiWajib.includes(divisi)) return { ...noGate, mode };

		const today = new Date().toISOString().slice(0, 10);
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
