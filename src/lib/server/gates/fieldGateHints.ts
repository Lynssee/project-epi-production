// src/lib/server/gates/fieldGateHints.ts
// Gate Transparan & Popup Benahi Data (dashboard lapangan), Fase 1 — pembaca konten
// gate (hint/checklist_items/consequence/owner_role/bypass_policy/action_type) dari
// admin erp-epi-1 (GET /api/gates/modes), TANPA query Directus langsung dan TANPA
// hardcode kalimat baru di sini (satu sumber kebenaran = gate_definitions, diedit di
// erp-epi /settings/gates).
//
// Pola sama seperti gateEnforcement.ts: cache in-memory 5 menit per scope. Auth: kedua
// repo berbagi Firebase project yang sama (lihat pengajuan-preflight/+server.ts) —
// token ID Firebase pemanggil diteruskan apa adanya, tidak ada mekanisme auth baru.
//
// Fail-soft mutlak: kalau ERP_EPI1_BASE_URL kosong atau admin tak terjangkau, balas
// {available:false, reason} — TIDAK PERNAH melempar, TIDAK PERNAH menahan leader.

import { env } from '$env/dynamic/private';

const CACHE_TTL_MS = 5 * 60 * 1000;

export interface FieldGateHintEntry {
	mode: string;
	message: string | null;
	hint: string | null;
	severity_hint: string | null;
	nama: string;
	action_type: string | null;
	action_config: Record<string, unknown> | null;
	bypass_policy: Record<string, unknown> | null;
	checklist_items: Array<{ id: string; label: string; wajib?: boolean; kategori?: string; deskripsi?: string; tips?: string }> | null;
	owner_role: string | null;
}

export type FieldGateHintMap = Record<string, FieldGateHintEntry>;

export interface FieldGateHintResult {
	available: boolean;
	modes?: FieldGateHintMap;
	reason?: string;
}

const cache = new Map<string, { at: number; data: FieldGateHintMap }>();

function cacheKey(modul: string, documentType: string, jenisPengajuan: string | null): string {
	return `${modul}::${documentType}::${jenisPengajuan || ''}`;
}

/**
 * Ambil konten gate untuk satu scope (modul+document_type[+jenis_pengajuan]) dari
 * admin erp-epi-1. `authHeader` diteruskan apa adanya dari request pemanggil.
 */
export async function fetchFieldGateHints(
	modul: string,
	documentType: string,
	authHeader: string,
	jenisPengajuan: string | null = null
): Promise<FieldGateHintResult> {
	const key = cacheKey(modul, documentType, jenisPengajuan);
	const cached = cache.get(key);
	if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
		return { available: true, modes: cached.data };
	}

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) {
		return { available: false, reason: 'Panduan gate belum dikonfigurasi (ERP_EPI1_BASE_URL kosong).' };
	}

	try {
		const params = new URLSearchParams({ modul, document_type: documentType });
		if (jenisPengajuan) params.set('jenis_pengajuan', jenisPengajuan);
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/gates/modes?${params.toString()}`, {
			headers: { Authorization: authHeader },
			signal: AbortSignal.timeout(10000)
		});
		if (!res.ok) {
			return { available: false, reason: `Admin membalas ${res.status} — panduan lengkap tidak dapat dimuat.` };
		}
		const body = await res.json().catch(() => ({}));
		const modes: FieldGateHintMap = body?.modes || {};
		cache.set(key, { at: Date.now(), data: modes });
		return { available: true, modes };
	} catch (e) {
		console.warn('[fieldGateHints] gagal menghubungi admin:', (e as Error)?.message);
		return { available: false, reason: 'Tidak dapat menghubungi admin saat ini — panduan lengkap tidak dapat dimuat.' };
	}
}

/** Buang cache — dipakai setelah admin mengubah konten gate lewat /settings/gates. */
export function invalidateFieldGateHintsCache(): void {
	cache.clear();
}
