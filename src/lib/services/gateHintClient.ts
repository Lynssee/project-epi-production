// src/lib/services/gateHintClient.ts
// Gate Transparan & Popup Benahi Data, Fase 1 — sisi klien. Ambil konten gate lewat
// proxy lokal `/api/gates/hints` (bukan Directus langsung, bukan hardcode kalimat baru)
// dan tempelkan ke daftar gate hasil pra-cek (plFieldGates.ts dkk / preflight PA).
//
// Cache 2 menit di klien (di atas cache 5 menit server) — hemat panggilan berulang
// saat wizard dibuka-tutup dalam sesi yang sama.

const CLIENT_CACHE_TTL_MS = 2 * 60 * 1000;

export interface GateHintEntry {
	mode: string;
	message: string | null;
	hint: string | null;
	severity_hint: string | null;
	nama: string;
	action_type: string | null;
	action_config: { note?: string; consequence?: string; fieldHint?: string; links?: Array<{ label: string; href: string }>; dynamic_links?: boolean; field_actions?: unknown[] } | null;
	bypass_policy: { method: string; who?: string; how?: string; trace?: string } | null;
	checklist_items: Array<{ id: string; label: string; wajib?: boolean; kategori?: string; deskripsi?: string; tips?: string }> | null;
	owner_role: string | null;
}

export interface GateHintResult {
	available: boolean;
	modes?: Record<string, GateHintEntry>;
	reason?: string;
}

const clientCache = new Map<string, { at: number; data: GateHintResult }>();

/** Ambil konten gate untuk satu scope. Fail-soft: error jaringan balas {available:false}. */
export async function fetchGateHints(
	modul: string,
	documentType: string,
	jenisPengajuan?: string | null
): Promise<GateHintResult> {
	const key = `${modul}::${documentType}::${jenisPengajuan || ''}`;
	const cached = clientCache.get(key);
	if (cached && Date.now() - cached.at < CLIENT_CACHE_TTL_MS) return cached.data;

	try {
		const params = new URLSearchParams({ modul, document_type: documentType });
		if (jenisPengajuan) params.set('jenis_pengajuan', jenisPengajuan);
		const res = await fetch(`/api/gates/hints?${params.toString()}`);
		const data: GateHintResult = await res.json();
		clientCache.set(key, { at: Date.now(), data });
		return data;
	} catch (e) {
		console.warn('[gateHintClient] gagal memuat hint gate:', (e as Error)?.message);
		return { available: false, reason: 'Gagal memuat panduan gate.' };
	}
}

/**
 * Tempelkan konten gate (hint/checklist_items/consequence/owner_role/bypass_policy/
 * action_type) ke daftar gate hasil pra-cek. Gate yang tidak punya entri di hintMap
 * dibiarkan apa adanya (nol regresi) — wizard jatuh balik ke `message` bawaan.
 */
export function applyGateHints<T extends { gate_key: string; [key: string]: unknown }>(
	gates: T[],
	hintResult: GateHintResult | null | undefined
): T[] {
	if (!hintResult?.available || !hintResult.modes) return gates;
	const modes = hintResult.modes;
	return gates.map((g) => {
		const h = modes[g.gate_key];
		if (!h) return g;
		return {
			...g,
			hint: h.hint ?? (g as any).hint ?? null,
			checklist_items: h.checklist_items ?? null,
			consequence: h.action_config?.consequence ?? null,
			owner_role: h.owner_role ?? null,
			bypass_policy: h.bypass_policy ?? null,
			action_type: h.action_type ?? null,
			action_config: h.action_config ?? null
		};
	});
}
