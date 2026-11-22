// src/routes/api/produksi/ambang-reject-waste/+server.ts
// Ambang peringatan reject/waste untuk banner Input Produksi Harian (Fase 3 Blueprint SOP Manufaktur).
// Sumber: app_settings module=production (reject_rate_alert_pct, waste_rate_alert_pct) — diatur Super Admin di erp-epi.
// Cache 60 dtk (hemat API). Gagal baca = klien memakai default, tetapi SELALU dilog (CLAUDE.md #1).
//   GET -> { rejectMaxPct: number|null, wasteMaxPct: number|null }   (null = belum diatur → klien pakai default)

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { requirePermission } from '$lib/server/rbacServer';
import { directusServerJson } from '$lib/server/directus';

const PERMISSION = 'input_produksi_harian';
const TTL_MS = 60_000;
let cache: { at: number; value: { rejectMaxPct: number | null; wasteMaxPct: number | null } } | null = null;

const toPct = (v: unknown): number | null => {
	let x: unknown = v;
	if (typeof x === 'string') {
		try { x = JSON.parse(x); } catch { /* biarkan string mentah */ }
	}
	const n = parseFloat(String(x ?? ''));
	return Number.isFinite(n) && n > 0 ? n : null;
};

async function loadThresholds() {
	if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
	const filter = encodeURIComponent(
		JSON.stringify({ module: { _eq: 'production' }, setting_key: { _in: ['reject_rate_alert_pct', 'waste_rate_alert_pct'] } })
	);
	const res = await directusServerJson<{ data: Array<{ setting_key: string; setting_value: unknown }> }>(
		`/items/app_settings?filter=${filter}&fields=setting_key,setting_value&limit=-1`
	);
	const rows = res?.data || [];
	const val = (k: string) => toPct(rows.find((r) => r.setting_key === k)?.setting_value);
	const value = { rejectMaxPct: val('reject_rate_alert_pct'), wasteMaxPct: val('waste_rate_alert_pct') };
	cache = { at: Date.now(), value };
	return value;
}

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	await requirePermission(event, user.localId, PERMISSION);
	try {
		return json(await loadThresholds());
	} catch (e) {
		console.error('[produksi/ambang-reject-waste] gagal baca setelan, klien pakai default:', (e as Error)?.message);
		return json({ rejectMaxPct: null, wasteMaxPct: null });
	}
};
