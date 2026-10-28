// src/lib/server/rekeningPenerimaServer.ts
// SERVER-ONLY. Penajaman Penerima Dana & Track Record v2, Fase 4 (11 Sep 2026).
// Kembaran ringan dari erp-epi src/lib/server/rekeningPenerimaServer.js — hanya
// ensureRekening() (dipakai endpoint register lapangan). Logika inti (normalisasi/
// deteksi tagihan) dari src/lib/shared/rekeningCore.js (disalin apa adanya dari erp-epi).

import { directusServerJson } from '$lib/server/directus';
import { normalizeRekening, resolveBank, isTagihan, DEFAULT_BANK_DAFTAR, DEFAULT_TAGIHAN_POLA } from '$lib/shared/rekeningCore.js';

let settingsCache: { daftar: any[]; pola: string; fetchedAt: number } | null = null;
const SETTINGS_TTL_MS = 5 * 60 * 1000;

export async function getRekeningSettings() {
	const now = Date.now();
	if (settingsCache && now - settingsCache.fetchedAt < SETTINGS_TTL_MS) return settingsCache;
	let daftar = DEFAULT_BANK_DAFTAR;
	let pola = DEFAULT_TAGIHAN_POLA;
	try {
		const res = await directusServerJson<{ data: any[] }>(
			'/items/app_settings?filter[module][_eq]=finance_rekening&fields=setting_key,setting_value&limit=-1'
		);
		for (const r of res?.data || []) {
			if (r.setting_key === 'bank.daftar') {
				try { daftar = JSON.parse(r.setting_value); } catch { /* pakai default */ }
			}
			if (r.setting_key === 'tagihan.pola' && r.setting_value) pola = r.setting_value;
		}
	} catch { /* pakai default */ }
	settingsCache = { daftar, pola, fetchedAt: now };
	return settingsCache;
}

export interface EnsureRekeningParams {
	bankNameRaw?: string;
	rekeningRaw: string | number;
	atasNama?: string;
	pemilikTipe?: 'karyawan' | 'manpower' | 'supplier' | 'pihak_lain' | 'internal';
	pemilikRefCollection?: string | null;
	pemilikRefId?: string | number | null;
	sumber?: 'manual' | 'form_admin' | 'form_lapangan' | 'sistem' | 'backfill';
	firstPengajuanId?: number | null;
}

/** Sama persis ensureRekening() erp-epi — satu titik idempoten registri rekening.
 * null bila nomor kosong ATAU terdeteksi Tagihan/VA (sengaja tidak masuk registri). */
export async function ensureRekening({
	bankNameRaw = '',
	rekeningRaw,
	atasNama = '',
	pemilikTipe = 'pihak_lain',
	pemilikRefCollection = null,
	pemilikRefId = null,
	sumber = 'form_lapangan',
	firstPengajuanId = null
}: EnsureRekeningParams): Promise<any | null> {
	const norm = normalizeRekening(rekeningRaw);
	if (!norm) return null;
	const { daftar, pola } = await getRekeningSettings();
	if (isTagihan(bankNameRaw, atasNama, pola)) return null;

	const bank = resolveBank(bankNameRaw, daftar);
	const filter = encodeURIComponent(JSON.stringify({ bank_kode: { _eq: bank.kode }, rekening_norm: { _eq: norm } }));
	const existing = await directusServerJson<{ data: any[] }>(`/items/rekening_penerima?filter=${filter}&limit=1`).catch(() => null);
	if (existing?.data?.[0]) return existing.data[0];

	const created = await directusServerJson<{ data: any }>('/items/rekening_penerima', {
		method: 'POST',
		body: JSON.stringify({
			bank_kode: bank.kode,
			bank_nama_raw: bankNameRaw || null,
			rekening_norm: norm,
			atas_nama: atasNama || null,
			pemilik_tipe: pemilikTipe,
			pemilik_ref_collection: pemilikRefCollection,
			pemilik_ref_id: pemilikRefId != null ? String(pemilikRefId) : null,
			status_verifikasi: 'belum',
			status: 'aktif',
			sumber,
			perlu_review: pemilikTipe !== 'pihak_lain',
			first_pengajuan_id: firstPengajuanId
		})
	}).catch((e) => {
		console.error('[rekeningPenerimaServer] Gagal ensureRekening:', e?.message);
		return null;
	});
	return created?.data || null;
}

export function maskRekeningNorm(norm: unknown): string | null {
	const digits = String(norm ?? '').replace(/\D+/g, '');
	if (!digits) return null;
	return digits.length >= 4 ? `****${digits.slice(-4)}` : `****${digits}`;
}
