// src/routes/api/process-guidance/flows/gateInfo.ts
// Ringkasan gate untuk kartu "Siklus Dokumen & Syarat Lolos Gate" di /panduan/alur (hanya baca, hemat kuota).
// Sumber kebenaran = gate_definitions di admin (erp-epi /settings/gates); di sini HANYA membaca lewat fetchFieldGateHints
// (cache server 5 menit per scope, token pemanggil diteruskan). Tidak ada kalimat gate yang di-hardcode.
// Satu panggilan klien = satu alur; scope (modul × jenis dokumen) yang dibaca dibatasi MAX_SCOPES supaya tidak membebani admin.
// Fail-soft: scope yang gagal dilewati dan ditandai `partial`; semua gagal → { available:false, reason } (kartu tetap menampilkan kunci gate).
import type { ProcessFlow } from '$lib/data/processGuidance';
import { fetchFieldGateHints, type FieldGateHintEntry } from '$lib/server/gates/fieldGateHints';

export const MAX_SCOPES = 8;
const MAX_CHECKLIST = 8;
const clip = (s: string | null | undefined, n: number): string | null => (typeof s === 'string' && s.trim() ? s.trim().slice(0, n) : null);

export interface FieldGateInfo {
	mode: string;
	nama: string;
	message: string | null;
	hint: string | null;
	owner_role: string | null;
	bypass: string | null;
	checklist: { label: string; wajib: boolean; tips: string | null }[];
}
export interface FieldGateInfoResult {
	available: boolean;
	gates: Record<string, FieldGateInfo>;
	partial?: boolean;
	reason?: string;
}

/** Scope (modul × jenis dokumen) unik yang dirujuk gate di langkah alur. */
export function collectGateScopes(flow: Pick<ProcessFlow, 'nodes'> | null | undefined): { modul: string; documentType: string }[] {
	const seen = new Map<string, { modul: string; documentType: string }>();
	for (const n of flow?.nodes ?? []) {
		for (const g of n?.gates ?? []) {
			const modul = String(g?.modul ?? '').trim();
			const documentType = String(g?.documentType ?? '').trim();
			if (modul && documentType) seen.set(`${modul}::${documentType}`, { modul, documentType });
		}
	}
	return [...seen.values()];
}

/** Kunci gate yang dirujuk alur. */
export function gateKeysOfFlow(flow: Pick<ProcessFlow, 'nodes'> | null | undefined): Set<string> {
	const out = new Set<string>();
	for (const n of flow?.nodes ?? []) for (const g of n?.gates ?? []) if (g?.key) out.add(g.key);
	return out;
}

export function compactGate(e: FieldGateHintEntry): FieldGateInfo {
	const bp = e.bypass_policy as { method?: unknown } | null;
	return {
		mode: e.mode || 'shadow',
		nama: e.nama || '',
		message: clip(e.message, 300),
		hint: clip(e.hint, 400),
		owner_role: clip(e.owner_role, 80),
		bypass: bp && typeof bp.method === 'string' && bp.method !== 'none' ? bp.method : null,
		checklist: (Array.isArray(e.checklist_items) ? e.checklist_items : [])
			.filter((c) => c && typeof c.label === 'string' && c.label.trim())
			.slice(0, MAX_CHECKLIST)
			.map((c) => ({ label: c.label.trim().slice(0, 200), wajib: c.wajib !== false, tips: clip(c.tips, 200) }))
	};
}

export async function loadGateInfoForFlow(flow: ProcessFlow, authHeader: string): Promise<FieldGateInfoResult> {
	const keys = gateKeysOfFlow(flow);
	if (keys.size === 0) return { available: true, gates: {} };
	const scopes = collectGateScopes(flow);
	const used = scopes.slice(0, MAX_SCOPES);
	const results = await Promise.all(used.map((s) => fetchFieldGateHints(s.modul, s.documentType, authHeader).catch((e) => ({ available: false, reason: e instanceof Error ? e.message : String(e) }))));

	const gates: Record<string, FieldGateInfo> = {};
	let failed = 0;
	let reason: string | undefined;
	for (const r of results) {
		if (!r.available || !r.modes) {
			failed++;
			reason ??= r.reason;
			continue;
		}
		for (const [key, entry] of Object.entries(r.modes)) if (keys.has(key) && !gates[key]) gates[key] = compactGate(entry);
	}
	if (used.length > 0 && failed === used.length) return { available: false, gates: {}, reason: reason || 'Panduan gate tidak dapat dimuat.' };
	const partial = failed > 0 || scopes.length > used.length;
	return { available: true, gates, ...(partial ? { partial: true } : {}) };
}
