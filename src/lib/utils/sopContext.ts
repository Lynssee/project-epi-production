// src/lib/utils/sopContext.ts
// Konteks "Panduan, SOP & Gate" per tab proyek (Fase 5 SOP Proyek). MURNI. Menyalin aturan util admin
// (erp-epi: src/lib/utils/projectSopContext.js) — kunci tab = kunci tab ADMIN (/project?tab=...), karena satu konfigurasi
// app_settings module 'project' / key 'sop_context_map' (diatur Superadmin di dashboard admin) melayani kedua dashboard.

export type SopContextEntry = { sops: string[]; gates: string[]; catatan: string };

const TAB_RE = /^[a-z0-9-]{1,40}$/;
const SOP_RE = /^[A-Za-z0-9][A-Za-z0-9/_-]{1,39}$/;
const GATE_RE = /^G_[A-Z0-9_]{2,80}$/;
const MAX_SOPS = 8;
const MAX_GATES = 12;

/** Tab cockpit lapangan (MainTab) → kunci tab konfigurasi admin. 'hse' & 'kirim' tak punya padanan (konteks kosong). */
export const FIELD_TAB_TO_CONTEXT_KEY: Record<string, string> = {
	informasi: 'list-project',
	keuangan: 'keuangan-summary',
	laporan: 'laporan-harian',
	progress: 'timeline-all',
	manpower: 'manpower',
	barang: 'packing-list',
	dokumen: 'dokumen'
};

/** Bawaan bila admin belum mengatur (sama dengan bawaan admin). */
export const DEFAULT_CONTEXT: Record<string, { sops: string[]; gates: string[] }> = {
	'laporan-harian': { sops: ['SOP-PRJ-009', 'SOP-PRJ-113'], gates: ['G_LH_ANTI_SALIN', 'G_LH_PROGRESS_SUBTASK', 'G_LH_CUSTOMER_RELEASE', 'G_LAPOR_SUBTASK_SCHEDULE'] },
	'packing-list': { sops: ['SOP-PRJ-104', 'SOP-PRJ-020'], gates: ['G_PKL_RAB_QUOTA', 'G_PKL_COVERAGE_M2', 'G_PKL_KIT_LENGKAP', 'G_PKL_APD_SIAP'] },
	'list-project': { sops: ['SOP-PRJ-010', 'SOP-PRJ-002'], gates: ['G_PRJ_PLANNING_ALIGNMENT', 'G_PRJ_SCOPE_SPEC_COMPLETE', 'G_MOB_SYNC'] },
	manpower: { sops: ['SOP-PRJ-419', 'SOP-PRJ-034'], gates: ['G_PRJ_LEADER_ASSIGNED', 'G_PRJ_LEADER_HANDOVER'] },
	'keuangan-summary': { sops: ['SOP-PRJ-089'], gates: ['G_PRJ_ZERO_EXPENSE', 'G_PRJ_NONBUDGET_OVERRUN'] },
	'timeline-all': { sops: ['SOP-PRJ-215'], gates: ['G_TARGET_DEVIASI'] },
	dokumen: { sops: ['SOP-PRJ-118', 'SOP-PRJ-038'], gates: [] }
};

const uniq = (v: unknown, re: RegExp, max: number): string[] => {
	const out: string[] = [];
	for (const x of Array.isArray(v) ? v : []) {
		const s = typeof x === 'string' ? x.trim() : '';
		if (s && re.test(s) && !out.includes(s)) out.push(s);
		if (out.length >= max) break;
	}
	return out;
};

export function normalizeEntry(e: unknown): SopContextEntry {
	const o = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
	return {
		sops: uniq(o.sops, SOP_RE, MAX_SOPS),
		gates: uniq(o.gates, GATE_RE, MAX_GATES),
		catatan: typeof o.catatan === 'string' ? o.catatan.trim().slice(0, 240) : ''
	};
}

export function normalizeStored(raw: unknown): Record<string, SopContextEntry> {
	let v: unknown = raw;
	if (typeof v === 'string') {
		try { v = JSON.parse(v); } catch { return {}; }
	}
	if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
	const out: Record<string, SopContextEntry> = {};
	for (const [tab, entry] of Object.entries(v as Record<string, unknown>)) {
		if (TAB_RE.test(tab)) out[tab] = normalizeEntry(entry);
	}
	return out;
}

/** Tersimpan (admin) menimpa bawaan; tab tak dikenal → kosong. */
export function resolveContext(stored: unknown, key: string): SopContextEntry & { sumber: 'tersimpan' | 'bawaan' | 'kosong' } {
	const s = normalizeStored(stored);
	if (s[key]) return { ...s[key], sumber: 'tersimpan' };
	if (DEFAULT_CONTEXT[key]) return { ...normalizeEntry(DEFAULT_CONTEXT[key]), sumber: 'bawaan' };
	return { sops: [], gates: [], catatan: '', sumber: 'kosong' };
}

/** Kunci konteks untuk tab cockpit lapangan, atau null bila tak ada padanan. */
export const contextKeyForFieldTab = (tab: string): string | null => FIELD_TAB_TO_CONTEXT_KEY[tab] ?? null;
