// src/lib/server/gates/cultureTbmGate.ts
// Gate G_TBM_CULTURE_BRIEF (Budaya & Propaganda Fase 4) untuk /api/tbm-rollcall/submit. Mode/aktif/enforce_from/override diatur Superadmin
// di erp-epi /settings/gates (gate_definitions + gate_enforcement) — TIDAK di-hardcode di sini. Evaluator: ess/cultureModel.ts#evalTbmBrief.
// ANTI-LOCKDOWN (Aturan #3): definisi gate belum terdaftar / gagal baca = 'shadow' (tidak pernah menahan presensi TBM). Catatan: resolveGateMode()
// bawaan memakai 'soft' bila definisi tak ada — pembungkus ini sengaja menimpa fallback itu menjadi 'shadow'.

import { directusServerJson } from '$lib/server/directus';
import { resolveGateMode, type GateMode } from '$lib/server/gateDefinitionsMode';
import { writeGateAudit } from '$lib/server/gates/gateAudit';
import { getTbmCultureContext } from '$lib/server/ess/budayaHarian';
import { evalTbmBrief } from '$lib/server/ess/cultureModel';

export const TBM_CULTURE_GATE_KEY = 'G_TBM_CULTURE_BRIEF';
export const TBM_CULTURE_DOC_TYPE = 'tbm_culture';
export const MIN_ALASAN_LEN = 10;

const defCache = new Map<string, { at: number; ada: boolean }>();

/** Hanya untuk test / setelah gate baru di-seed. */
export function clearTbmGateCache(): void {
	defCache.clear();
}

async function gateTerdaftar(key: string): Promise<boolean> {
	const c = defCache.get(key);
	if (c && Date.now() - c.at < 300_000) return c.ada;
	let ada = false;
	try {
		const res: any = await directusServerJson(`/items/gate_definitions?filter[gate_key][_eq]=${encodeURIComponent(key)}&fields=gate_key&limit=1`);
		ada = !!res?.data?.[0];
		defCache.set(key, { at: Date.now(), ada });
	} catch (e) {
		console.error(`[cultureTbmGate] gagal memeriksa definisi ${key} — dianggap belum terdaftar (shadow):`, (e as Error)?.message);
	}
	return ada;
}

export type TbmGateDecision =
	| { aksi: 'lanjut'; mode: GateMode | 'n/a'; pesan: '' }
	| { aksi: 'peringatan'; mode: GateMode; pesan: string }
	| { aksi: 'butuh_alasan'; mode: GateMode; pesan: string }
	| { aksi: 'blokir'; mode: GateMode; pesan: string };

/** Keputusan murni dari mode + hasil evaluasi + alasan pengecualian (dipisah agar mudah diuji). */
export function decideTbmGate(mode: GateMode, status: string, message: string, alasan: string): TbmGateDecision {
	if (status !== 'failed') return { aksi: 'lanjut', mode, pesan: '' };
	if (mode === 'hard') return { aksi: 'blokir', mode, pesan: message };
	if (mode === 'soft') return alasan.trim().length >= MIN_ALASAN_LEN ? { aksi: 'lanjut', mode, pesan: '' } : { aksi: 'butuh_alasan', mode, pesan: message };
	if (mode === 'warn') return { aksi: 'peringatan', mode, pesan: message };
	return { aksi: 'lanjut', mode, pesan: '' }; // shadow
}

export async function evaluateTbmCultureGate(input: {
	projectId: number | string | null;
	topic: string;
	dibacakan: boolean;
	alasan: string;
}): Promise<TbmGateDecision> {
	const ctx = await getTbmCultureContext();
	const result = evalTbmBrief({ hasItem: ctx.hasItem, topic: input.topic, dibacakan: input.dibacakan });
	if (result.status !== 'failed') return { aksi: 'lanjut', mode: 'n/a', pesan: '' };

	const mode: GateMode = (await gateTerdaftar(TBM_CULTURE_GATE_KEY)) ? await resolveGateMode(TBM_CULTURE_GATE_KEY, TBM_CULTURE_DOC_TYPE) : 'shadow';
	const decision = decideTbmGate(mode, result.status, result.message, input.alasan);
	await writeGateAudit({
		gate: TBM_CULTURE_GATE_KEY,
		collection: 'manpower_absensi',
		recordId: input.projectId,
		decision: decision.aksi === 'blokir' ? 'block' : decision.aksi === 'lanjut' && mode !== 'shadow' ? 'allow' : decision.aksi === 'lanjut' ? 'shadow' : 'warn',
		reason: decision.aksi === 'lanjut' && input.alasan.trim() ? `Pengecualian: ${input.alasan.trim()}` : result.message,
		snapshot: { mode, judul_konten: ctx.judul, topic_kosong: !input.topic.trim(), dibacakan: input.dibacakan },
		email: null
	});
	return decision;
}
