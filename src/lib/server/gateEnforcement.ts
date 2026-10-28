// src/lib/server/gateEnforcement.ts
// Fase 0 v2 "Perketat Gate BBM & E-Toll" (9 Sep 2026): pembaca koleksi Directus
// `gate_enforcement` dari sisi project-epi — query LANGSUNG (bukan proxy erp-epi,
// keputusan user 8 Sep 2026), cache in-memory 5 menit, pola sama rndSettings.js.
//
// G_RMR_VISIT/G_BBM_VISIT/G_SJ_KIRIM/G_BUKTI_BBM/G_BUKTI_STRUK adalah gate BARU
// (Fase 3b + Fase 2, 8-9 Sep 2026) yang lahir/berpotensi lahir hard-block TANPA
// melalui gate_enforcement sama sekali — pelanggaran Aturan Anti-Kesalahan #3
// CLAUDE.md (gate baru lahir langsung wajib, bukan shadow/soft dulu). Modul ini
// membungkusnya supaya konsisten dengan prinsip #2 rencana v2: "tidak ada gate
// baru yang lahir langsung hard".
//
// ⚠️ HANYA baris `jenis_pengajuan='*'` yang dibaca di sini — SENGAJA, bukan bug.
// `G_P2H_UNIT` sudah punya baris 'hard' terpisah untuk jenis_pengajuan PA-OPS/
// PA-PRJ (K2, sisi erp-epi Pengajuan Anggaran) — kalau reader ini ambil baris
// PERTAMA per gate_key tanpa filter jenis, ia akan salah comot baris PA yang
// 'hard' itu untuk konteks lapangan (biaya-lapangan) yang JUSTRU baru pertama
// kali dikonfigurasi di sini dan seharusnya mulai 'shadow'. Baris '*' untuk
// gate-gate ini didaftarkan terpisah lewat skrip seed (lihat catatan komit).

import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';

const CACHE_TTL_MS = 5 * 60 * 1000;

export type GateMode = 'shadow' | 'soft' | 'hard';

interface GateEnforcementRow {
	mode: GateMode;
	// Paket 06 §2.5 (Aturan #3) — sebelum tanggal ini, mode 'hard' DIPAKSA jadi 'soft'
	// (masa tenggang), walau kolom mode di Directus sudah 'hard'. null = tidak ada tenggang.
	enforce_from: string | null;
}

export type FieldGateKey =
	| 'G_RMR_VISIT'
	| 'G_BBM_VISIT'
	| 'G_SJ_KIRIM'
	| 'G_BUKTI_BBM'
	| 'G_BUKTI_STRUK'
	| 'G_P2H_UNIT_LAPANGAN'
	| 'G_ADVANCE_NO_DOUBLE'
	| 'G_PRJ_BACKCHARGE_EVIDENCE'
	| 'G_PRJ_NONBUDGET_OVERRUN'
	| 'G_INV_NON_ELTAMA_RETURN_BLOCK'
	| 'G_PRJ_NON_ELTAMA_ASSET_CLOSEOUT'
	| 'G_RTN_DOBEL'
	| 'G_SJ_MUAT_DISCAN';

const FIELD_GATE_KEYS: FieldGateKey[] = [
	'G_RMR_VISIT',
	'G_BBM_VISIT',
	'G_SJ_KIRIM',
	'G_BUKTI_BBM',
	'G_BUKTI_STRUK',
	'G_P2H_UNIT_LAPANGAN',
	'G_ADVANCE_NO_DOUBLE',
	'G_PRJ_BACKCHARGE_EVIDENCE',
	'G_PRJ_NONBUDGET_OVERRUN',
	'G_INV_NON_ELTAMA_RETURN_BLOCK',
	'G_PRJ_NON_ELTAMA_ASSET_CLOSEOUT',
	'G_RTN_DOBEL',
	'G_SJ_MUAT_DISCAN'
];

let cache: { at: number; byGateKey: Map<string, GateEnforcementRow> } | null = null;

// Revisi 4 (Aturan #11): gate BARU berikut juga mengikuti MODE UTAMA di /settings/gates (gate_definitions.default_mode)
// bila belum ada baris override gate_enforcement '*'. Gate lama SENGAJA tidak ikut (nol perubahan perilaku — Aturan #3).
const FALLBACK_DEFINISI = new Set<string>(['G_RTN_DOBEL', 'G_SJ_MUAT_DISCAN']);
let defCache: { at: number; byGateKey: Map<string, { mode: GateMode; enforce_from: string | null }> } | null = null;

async function loadDefinisi(): Promise<Map<string, { mode: GateMode; enforce_from: string | null }>> {
	if (defCache && Date.now() - defCache.at < CACHE_TTL_MS) return defCache.byGateKey;
	const byGateKey = new Map<string, { mode: GateMode; enforce_from: string | null }>();
	try {
		const res = await directusServerJson<{ data: Array<{ gate_key: string; default_mode: string; enforce_from: string | null; is_active: boolean | null }> }>(
			`/items/gate_definitions?filter[gate_key][_in]=${[...FALLBACK_DEFINISI].join(',')}&fields=gate_key,default_mode,enforce_from,is_active&limit=-1`
		);
		for (const r of res?.data || []) {
			if (r.is_active === false) continue;
			// 'warn' tidak dikenal di sisi lapangan: tidak pernah memblokir → diperlakukan shadow.
			const mode: GateMode = r.default_mode === 'hard' || r.default_mode === 'soft' ? r.default_mode : 'shadow';
			byGateKey.set(r.gate_key, { mode, enforce_from: r.enforce_from ? String(r.enforce_from).slice(0, 10) : null });
		}
	} catch (e) {
		// Gagal baca ≠ tak terdaftar: dicatat jelas; mode aman = shadow, dan TIDAK di-cache agar pulih begitu Directus kembali.
		console.error('[gateEnforcement] gate_definitions tak terbaca — gate Revisi 4 dianggap shadow:', e instanceof Error ? e.message : e);
		return byGateKey;
	}
	defCache = { at: Date.now(), byGateKey };
	return byGateKey;
}

async function loadAll(): Promise<Map<string, GateEnforcementRow>> {
	if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.byGateKey;

	const keysParam = FIELD_GATE_KEYS.join(',');
	const res = await directusServerJson<{ data: Array<{ gate_key: string; mode: GateMode; enforce_from: string | null }> }>(
		`/items/gate_enforcement?filter[gate_key][_in]=${keysParam}&filter[jenis_pengajuan][_eq]=*&fields=gate_key,mode,enforce_from&limit=-1`
	).catch(() => null);

	const byGateKey = new Map<string, GateEnforcementRow>();
	for (const row of res?.data || []) {
		byGateKey.set(row.gate_key, { mode: row.mode, enforce_from: row.enforce_from || null });
	}

	cache = { at: Date.now(), byGateKey };
	return byGateKey;
}

/**
 * Mode penegakan gate lapangan lintas-jenis (baris jenis_pengajuan='*' saja —
 * lihat catatan di atas). Default 'shadow' bila belum ada baris terdaftar —
 * paling aman, tidak pernah memblokir gate yang belum dikonfigurasi (Aturan #3).
 *
 * Paket 06 §2.5 — masa tenggang enforce_from: sebelum tanggal itu, 'hard' dipaksa
 * jadi 'soft' (tidak pernah memblokir user sebelum tanggal yang diumumkan admin).
 */
export async function getFieldGateMode(gateKey: FieldGateKey): Promise<GateMode> {
	const byGateKey = await loadAll();
	const row = byGateKey.get(gateKey);
	if (!row) {
		if (!FALLBACK_DEFINISI.has(gateKey)) return 'shadow';
		const def = (await loadDefinisi()).get(gateKey);
		if (!def) return 'shadow';
		// Sebelum enforce_from: tidak menggigit sama sekali (shadow), sesuai Aturan #3.
		if (def.mode !== 'shadow' && def.enforce_from && todayJakarta() < def.enforce_from) return 'shadow';
		return def.mode;
	}
	if (row.mode === 'hard' && row.enforce_from && todayJakarta() < row.enforce_from.slice(0, 10)) {
		return 'soft';
	}
	return row.mode;
}

/** Buang cache — dipakai setelah admin menaikkan/menurunkan mode lewat Directus/UI. */
export function invalidateFieldGateEnforcementCache(): void {
	cache = null;
	defCache = null;
}
