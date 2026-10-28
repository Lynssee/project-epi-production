// src/lib/services/pengajuanSubmitEngineSettings.ts
// Fase 1 (Rencana v2 Shift-Left Gate Anggaran, 25 Sep 2026) — flag mitigasi risiko
// (rencana §9): `app_settings` module=pengajuan key=submit_decision_engine, nilai
// legacy|shadow|on. Pola pembacaan sama dengan manpowerSettings.ts (cache 5 menit,
// fail-soft ke default bila Directus tak terjangkau — TIDAK PERNAH menahan submit
// karena setelan gagal dimuat).
//
//   legacy — perilaku lama (daftar gate_key hardcode) yang menentukan blokir. Mesin
//            baru (evaluateSubmitDecision) tetap dihitung tapi hanya dibandingkan.
//   shadow — DEFAULT. Sama seperti legacy (legacy yang menentukan blokir), tapi
//            perbedaan hasil dicatat ke activity_log untuk observabilitas admin
//            sebelum memutuskan pindah ke 'on'.
//   on     — evaluateSubmitDecision yang menentukan blokir; daftar hardcode diabaikan.

import { readItems } from '@directus/sdk';
import directus from './directus';

export type SubmitDecisionEngineMode = 'legacy' | 'shadow' | 'on';

const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MODE: SubmitDecisionEngineMode = 'shadow';

let cache: SubmitDecisionEngineMode | null = null;
let cachedAt = 0;
let inflight: Promise<SubmitDecisionEngineMode> | null = null;

export async function loadSubmitDecisionEngineMode(force = false): Promise<SubmitDecisionEngineMode> {
	const now = Date.now();
	if (!force && cache && now - cachedAt < CACHE_TTL_MS) return cache;
	if (inflight) return inflight;

	inflight = (async () => {
		let mode: SubmitDecisionEngineMode = DEFAULT_MODE;
		try {
			const rows = await directus.request(
				readItems('app_settings' as any, {
					filter: { module: { _eq: 'pengajuan' }, setting_key: { _eq: 'submit_decision_engine' } } as any,
					limit: 1
				})
			);
			const raw = String((rows as any[])?.[0]?.setting_value ?? '').trim();
			if (raw === 'legacy' || raw === 'shadow' || raw === 'on') mode = raw;
		} catch (err) {
			console.warn('[pengajuanSubmitEngineSettings] Directus tak terjangkau — pakai default shadow.', err);
		}
		cache = mode;
		cachedAt = Date.now();
		inflight = null;
		return mode;
	})();

	return inflight;
}
