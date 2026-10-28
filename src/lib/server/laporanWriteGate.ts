// src/lib/server/laporanWriteGate.ts
// ⚠️ SERVER-ONLY. Fase 2 — Gerbang Keras Laporan Harian di titik tulis (sisi lapangan).
// Kembar dari erp-epi-1/src/lib/server/gates/laporanWriteGate.js — logika kondisi
// gate sama persis (laporanHarianRules), resolusi mode dibaca lewat pola
// gateDefinitionsMode.ts (project-epi TIDAK mengimpor gateEngine.js erp-epi —
// beda repo/deploy — tapi membaca koleksi Directus yang sama).
//
// Rencana: docs erp-epi-1 "Gate Keras Disiplin Data & Laporan Harian", Fase 2.
// Sakelar induk `system_settings: laporan.write_gate_enabled` (default OFF) —
// selama mati, decision SELALU 'allow' apa pun isi gate_definitions.

import { directusServerJson } from './directus';
import { evaluateLaporanHarianRules, type LaporanHarianSnapshot, type LaporanHarianPreviousReport, type LaporanHarianGate } from '$lib/shared/laporanHarianRules';
import { resolveEffectiveGateMode, type GateDefRow, type GateOverrideRow } from '$lib/utils/gateModeResolver';

export const LAPORAN_GATE_MODUL = 'project_report';
export const LAPORAN_GATE_DOCUMENT_TYPE = 'laporan_harian';
export const LAPORAN_WRITE_GATE_SETTING_KEY = 'laporan.write_gate_enabled';
const MIN_OVERRIDE_REASON_LEN = 20;

const SETTING_TTL_MS = 5 * 60 * 1000;
let settingCache: { at: number; value: boolean } = { at: 0, value: false };

export async function isLaporanWriteGateEnabled(opts: { force?: boolean } = {}): Promise<boolean> {
	const now = Date.now();
	if (!opts.force && now - settingCache.at < SETTING_TTL_MS) return settingCache.value;
	try {
		const res: any = await directusServerJson(
			`/items/system_settings?filter[setting_key][_eq]=${LAPORAN_WRITE_GATE_SETTING_KEY}&limit=1`
		);
		const raw = res?.data?.[0]?.setting_value;
		const value = raw === true || raw === 'true' || raw === '1' || raw === 1;
		settingCache = { at: now, value };
		return value;
	} catch (e: any) {
		console.warn('[laporanWriteGate] gagal baca system_settings, default OFF:', e?.message || e);
		settingCache = { at: now, value: false };
		return false;
	}
}

export function invalidateLaporanWriteGateCache(): void {
	settingCache = { at: 0, value: false };
}

const DEF_TTL_MS = 5 * 60 * 1000;
let defsCache: { at: number; defs: GateDefRow[]; overrides: GateOverrideRow[] } | null = null;

async function loadLaporanGateDefsAndOverrides(): Promise<{ defs: GateDefRow[]; overrides: GateOverrideRow[] }> {
	if (defsCache && Date.now() - defsCache.at < DEF_TTL_MS) return defsCache;
	const [defRes, ovRes]: any[] = await Promise.all([
		directusServerJson(
			`/items/gate_definitions?${new URLSearchParams({
				'filter[modul][_eq]': LAPORAN_GATE_MODUL,
				'filter[document_type][_in]': `${LAPORAN_GATE_DOCUMENT_TYPE},*`,
				'filter[is_active][_eq]': 'true',
				fields: 'gate_key,default_mode,enforce_from,is_active',
				limit: '-1'
			}).toString()}`
		),
		directusServerJson(
			`/items/gate_enforcement?${new URLSearchParams({
				'filter[jenis_pengajuan][_in]': `${LAPORAN_GATE_DOCUMENT_TYPE},*`,
				'filter[is_active][_neq]': 'false',
				fields: 'jenis_pengajuan,gate_key,mode,document_type,enforce_from,is_active',
				limit: '-1'
			}).toString()}`
		)
	]);
	const result = { at: Date.now(), defs: defRes?.data || [], overrides: ovRes?.data || [] };
	defsCache = result;
	return result;
}

export function invalidateLaporanGateDefsCache(): void {
	defsCache = null;
}

function computeQualityFields(gates: LaporanHarianGate[], score: number) {
	return {
		quality_score: score,
		quality_flags: gates.filter((g) => g.status === 'failed').map((g) => g.gate_key),
		quality_evaluated_at: new Date().toISOString()
	};
}

export interface LaporanWriteGateResult {
	enabled: boolean;
	decision: 'allow' | 'override' | 'reject';
	gates: LaporanHarianGate[];
	score: number;
	qualityFields: { quality_score: number; quality_flags: string[]; quality_evaluated_at: string };
	blockingGates: LaporanHarianGate[];
	overrideBy?: number | string | null;
	overrideReason?: string;
	selfApprovalBlocked?: boolean;
}

export async function evaluateLaporanWriteGate(
	snapshot: LaporanHarianSnapshot,
	opts: { previousReport?: LaporanHarianPreviousReport } = {}
): Promise<LaporanWriteGateResult> {
	const s = snapshot || {};
	const { gates, score } = evaluateLaporanHarianRules(s, { previousReport: opts.previousReport });
	const qualityFields = computeQualityFields(gates, score);

	const enabled = await isLaporanWriteGateEnabled();
	if (!enabled) {
		return { enabled: false, decision: 'allow', gates, score, qualityFields, blockingGates: [] };
	}

	let defs: GateDefRow[], overrides: GateOverrideRow[];
	try {
		({ defs, overrides } = await loadLaporanGateDefsAndOverrides());
	} catch (e: any) {
		console.error('[laporanWriteGate] gagal load gate_definitions, fail-open:', e?.message || e);
		return { enabled: true, decision: 'allow', gates, score, qualityFields, blockingGates: [] };
	}

	const defByKey = new Map(defs.map((d) => [d.gate_key, d]));
	const blockingGates: LaporanHarianGate[] = [];
	for (const g of gates) {
		if (g.status !== 'failed' || g.severity !== 'WAJIB') continue;
		const def = defByKey.get(g.gate_key) || null;
		if (!def) continue; // gate_key belum terdaftar -> shadow implisit
		const mode = resolveEffectiveGateMode(def, overrides, LAPORAN_GATE_DOCUMENT_TYPE);
		if (mode === 'hard') blockingGates.push(g);
	}

	if (blockingGates.length === 0) {
		return { enabled: true, decision: 'allow', gates, score, qualityFields, blockingGates: [] };
	}

	const overrideBy = s.gate_override_by ?? null;
	const overrideReason = String(s.gate_override_reason || '').trim();
	const isSelfApproval = overrideBy != null && String(overrideBy) === String(s.karyawan_id ?? '');
	const hasValidOverrideShape =
		overrideBy != null && overrideReason.length >= MIN_OVERRIDE_REASON_LEN && !isSelfApproval;

	if (hasValidOverrideShape) {
		return { enabled: true, decision: 'override', gates, score, qualityFields, blockingGates, overrideBy, overrideReason };
	}

	return { enabled: true, decision: 'reject', gates, score, qualityFields, blockingGates, selfApprovalBlocked: isSelfApproval };
}

/**
 * R2-07 — mode efektif satu gate server-side laporan harian dari registry (gate_definitions + override + enforce_from).
 * Gate belum terdaftar / gagal baca => 'shadow' (hanya mencatat, tidak pernah menolak). Saklar induk OFF => hard diturunkan ke 'soft'.
 */
export async function resolveLaporanGateMode(gateKey: string): Promise<'shadow' | 'warn' | 'soft' | 'hard'> {
	try {
		const { defs, overrides } = await loadLaporanGateDefsAndOverrides();
		const def = defs.find((d) => d.gate_key === gateKey);
		if (!def) return 'shadow';
		const mode = resolveEffectiveGateMode(def, overrides, LAPORAN_GATE_DOCUMENT_TYPE) as string;
		if (mode === 'hard' && !(await isLaporanWriteGateEnabled())) return 'soft';
		return mode === 'hard' || mode === 'soft' || mode === 'warn' ? mode : 'shadow';
	} catch (e: any) {
		console.error(`[laporanWriteGate] gagal resolusi mode ${gateKey} (pakai shadow):`, e?.message || e);
		return 'shadow';
	}
}
