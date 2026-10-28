// src/lib/server/gateDefinitionsMode.ts
// Resolusi mode gate dari koleksi gate_definitions + gate_enforcement (erp-epi) — dibaca
// LANGSUNG lewat Directus (Directus sama untuk erp-epi & project-epi), TANPA mengimpor
// gateEngine.js dari erp-epi (beda repo/deploy). Ini bukan gateEngine penuh: cukup untuk
// gate mandiri (standalone) di project-epi yang ingin mode-nya bisa diubah admin lewat
// erp-epi /settings/gates TANPA redeploy — sama pola resolveEffectiveMode() di
// erp-epi/src/lib/server/gates/gateEngine.js (Fase 4.3 Kontrol Patroli, 15 Sep 2026).
//
// TIDAK mengevaluasi `condition` — gate di sini dievaluasi manual di kode pemanggil
// (procurementSubmit.ts), gate_definitions.condition sengaja null untuk gate-gate ini.
//
// Logika keputusan (override menang, klem ke shadow via enforce_from) dipisah ke
// $lib/utils/gateModeResolver.ts (pure, tanpa $env) supaya bisa diuji unit test — lihat
// gateModeResolver.test.ts. File ini hanya I/O (fetch Directus) + cache.

import { directusServerJson } from './directus';
import { resolveEffectiveGateMode, type GateMode, type GateDefRow, type GateOverrideRow } from '$lib/utils/gateModeResolver';

export type { GateMode };

const CACHE_TTL_MS = 300_000;
const cache = new Map<string, { at: number; mode: GateMode }>();

/**
 * Mode efektif satu gate_key untuk documentType tertentu, dibaca dari
 * gate_definitions (default_mode) + gate_enforcement (override, spesifik menang
 * atas '*'), diklem ke 'shadow' bila enforce_from efektif masih di masa depan
 * (Aturan #3). Fallback 'soft' bila gate_definitions tidak ditemukan/gagal dibaca
 * (fail-safe: jangan pernah default ke 'hard' tanpa definisi eksplisit).
 */
export async function resolveGateMode(gateKey: string, documentType = 'pr'): Promise<GateMode> {
	const cacheKey = `${gateKey}|${documentType}`;
	const cached = cache.get(cacheKey);
	if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.mode;

	let mode: GateMode = 'soft';
	try {
		const defRes: any = await directusServerJson(
			`/items/gate_definitions?${new URLSearchParams({
				'filter[gate_key][_eq]': gateKey,
				'filter[is_active][_eq]': 'true',
				fields: 'gate_key,default_mode,enforce_from,is_active',
				limit: '1'
			}).toString()}`
		);
		const def: GateDefRow | undefined = defRes?.data?.[0];
		if (!def) {
			// Gate belum/tidak terdaftar -> fallback aman 'soft', bukan error keras.
			cache.set(cacheKey, { at: Date.now(), mode });
			return mode;
		}

		const ovRes: any = await directusServerJson(
			`/items/gate_enforcement?${new URLSearchParams({
				'filter[gate_key][_eq]': gateKey,
				'filter[jenis_pengajuan][_in]': `${documentType},*`,
				'filter[is_active][_neq]': 'false',
				fields: 'jenis_pengajuan,gate_key,mode,document_type,enforce_from,is_active',
				limit: '-1'
			}).toString()}`
		);
		const overrides: GateOverrideRow[] = ovRes?.data || [];
		mode = resolveEffectiveGateMode(def, overrides, documentType);
	} catch (err) {
		console.error(`[gateDefinitionsMode] gagal resolusi mode gate ${gateKey}, pakai default 'soft':`, err);
	}
	cache.set(cacheKey, { at: Date.now(), mode });
	return mode;
}

/** Untuk test / setelah admin ubah mode lewat /settings/gates. */
export function clearGateModeCache(): void {
	cache.clear();
}
