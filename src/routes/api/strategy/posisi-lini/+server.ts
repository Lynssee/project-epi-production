// src/routes/api/strategy/posisi-lini/+server.ts
// Strategic Suite v2 (Fase 6): kartu read-only "Posisi Lini" untuk sales/leader lapangan.
// Membaca snapshot Strategi terbaru (dibuat erp-epi) dengan token server, dan mengembalikan HANYA field aman:
// nama lini, kuadran, pertumbuhan jumlah proyek, jumlah proyek, rekomendasi. TIDAK ada nilai rupiah, pangsa, atau margin.
// Saklar `lapangan.posisi_lini_enabled` (app_settings module strategy, diatur di erp-epi /settings/strategy) — BAWAAN MATI.
// Satu panggilan ringan per tampilan; hasil di-cache memori 5 menit (hemat Directus).
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; body: unknown } | null = null;

export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);
	if (cache && Date.now() - cache.at < TTL_MS) return json(cache.body);

	try {
		const sw = await directusServerJson(
			`/items/app_settings?filter[module][_eq]=strategy&filter[setting_key][_eq]=lapangan.posisi_lini_enabled&limit=1&fields=setting_value`
		);
		const raw = sw?.data?.[0]?.setting_value;
		const enabled = raw === true || raw === 'true' || raw === 1 || raw === '1';
		if (!enabled) {
			const off = { enabled: false, items: [] };
			cache = { at: Date.now(), body: off };
			return json(off);
		}
		const snap = (await directusServerJson(`/items/strategy_snapshot?sort=-periode,-id&limit=1&fields=id,periode,generated_at,meta`))?.data?.[0];
		if (!snap?.id) return json({ enabled: true, items: [], periode: null, generated_at: null });
		const rows =
			(await directusServerJson(
				`/items/strategy_snapshot_metric?filter[snapshot_id][_eq]=${snap.id}&filter[metric_key][_eq]=bcg.lini&limit=50&fields=dimension,label,evidence`
			))?.data || [];
		const items = rows
			.filter((r: any) => r?.evidence)
			.map((r: any) => {
				const e = r.evidence;
				return {
					lini_key: String(r.dimension ?? e.lini_key ?? ''),
					label: String(e.label ?? r.label ?? r.dimension ?? ''),
					quadrant: e.quadrant ?? 'tidak_dinilai',
					growth_pct: e.growth_pct ?? null,
					projects_cur: Number(e.projects_cur) || 0,
					projects_prior: Number(e.projects_prior) || 0,
					action: e.action ?? null
				};
			});
		const body = { enabled: true, periode: snap.periode, generated_at: snap.generated_at, jendela: snap.meta?.window?.note ?? null, items };
		cache = { at: Date.now(), body };
		return json(body);
	} catch (e) {
		console.error('[strategy/posisi-lini] gagal:', e);
		return json({ enabled: false, items: [], error: 'Data posisi lini belum tersedia.' });
	}
};
