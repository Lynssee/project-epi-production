// src/lib/utils/gateModeResolver.ts
// Logika keputusan mode gate MURNI (tanpa I/O, tanpa import SvelteKit $env) — diekstrak dari
// $lib/server/gateDefinitionsMode.ts supaya bisa diuji unit test (node:test, lihat
// gateModeResolver.test.ts) tanpa mock Directus/$env. gateDefinitionsMode.ts (server-only)
// memanggil resolveEffectiveGateMode() ini setelah fetch data dari Directus.

export type GateMode = 'shadow' | 'soft' | 'warn' | 'hard';
const VALID_MODES = new Set<GateMode>(['shadow', 'soft', 'warn', 'hard']);

export interface GateDefRow {
	gate_key: string;
	default_mode: string;
	enforce_from: string | null;
	is_active: boolean;
}

export interface GateOverrideRow {
	jenis_pengajuan: string;
	gate_key: string;
	mode: string;
	document_type: string | null;
	enforce_from: string | null;
	is_active: boolean;
}

function inFuture(dateVal: string | null, nowMs: number): boolean {
	if (!dateVal) return false;
	const d = new Date(dateVal);
	if (isNaN(d.getTime())) return false;
	return d.getTime() > nowMs;
}

/**
 * Override gate_enforcement (document_type spesifik menang atas '*') menimpa default_mode;
 * lalu diklem ke 'shadow' bila enforce_from efektif masih di masa depan (Aturan #3 — anti
 * lockdown retroaktif untuk gate baru). def=null -> fallback 'soft' (gate belum terdaftar
 * di gate_definitions, bukan kondisi error).
 */
export function resolveEffectiveGateMode(
	def: GateDefRow | null,
	overrides: GateOverrideRow[],
	documentType: string,
	nowMs: number = Date.now()
): GateMode {
	if (!def) return 'soft';

	let mode: GateMode = VALID_MODES.has(def.default_mode as GateMode) ? (def.default_mode as GateMode) : 'shadow';
	let enforceFrom = def.enforce_from;

	const specific = overrides.find((r) => r.document_type && r.document_type === documentType);
	const generic = overrides.find((r) => !r.document_type || r.document_type === '*');
	const chosen = specific || generic;
	if (chosen && VALID_MODES.has(chosen.mode as GateMode)) {
		mode = chosen.mode as GateMode;
		if (chosen.enforce_from) enforceFrom = chosen.enforce_from;
	}

	if (mode !== 'shadow' && inFuture(enforceFrom, nowMs)) mode = 'shadow';
	return mode;
}
