// src/lib/server/ess/maintenanceMttr.ts
// MTTR pribadi mekanik untuk /ess/maintenance-kpi -- BERBASIS CAKUPAN DATA (Pertajaman KPI Multi-Periode, Fase 5 lanjutan).
// work_order.tanggal_done baru terisi ~8% di produksi, jadi rata-rata mentah akan didominasi data hilang dan menyesatkan.
// MTTR hanya DITAMPILKAN bila (a) jumlah WO selesai bertanggal >= ambang sampel DAN (b) persen WO selesai yang bertanggal
// >= ambang cakupan. Dengan begitu fiturnya aktif sendiri begitu pengisian tanggal selesai membaik, tanpa deploy ulang.
// Ambang di app_settings kpi_engine (ess_mttr_min_sample, ess_mttr_min_coverage_pct) -> bisa diubah di /settings/kpi-engine.
// Duplikat 1:1 dengan erp-epi/src/lib/server/ess/maintenanceMttr.js (dua repo, dua server; rumus harus sinkron manual).
//
// PM Compliance TIDAK dibuat: pm_due_tracker 196 baris, 0 yang last_done_date-nya terisi.

import { directusServerJson } from '$lib/server/directus';

export const DEFAULT_MTTR_MIN_SAMPLE = 5;
export const DEFAULT_MTTR_MIN_COVERAGE_PCT = 60;

export interface MttrSettings {
	minSample: number;
	minCoveragePct: number;
}

export interface MttrResult {
	mttrJam: number | null;
	mttrSample: number;
	mttrCoveragePct: number | null;
	mttrReady: boolean;
	mttrMinSample: number;
	mttrMinCoveragePct: number;
}

/** @param selesai WO berstatus selesai milik mekanik pada periode */
export function hitungMttr(
	selesai: Array<{ tanggal_done: string | null; created_at: string | null }>,
	{ minSample, minCoveragePct }: MttrSettings
): MttrResult {
	const jam: number[] = [];
	for (const w of selesai) {
		if (!w.tanggal_done || !w.created_at) continue;
		const h = (Date.parse(w.tanggal_done) - Date.parse(w.created_at)) / 36e5;
		if (Number.isFinite(h)) jam.push(Math.max(0, h));
	}
	const coveragePct = selesai.length > 0 ? Math.round((jam.length / selesai.length) * 100) : null;
	const ready = jam.length >= minSample && coveragePct !== null && coveragePct >= minCoveragePct;
	return {
		mttrJam: ready ? Math.round((jam.reduce((a, b) => a + b, 0) / jam.length) * 10) / 10 : null,
		mttrSample: jam.length,
		mttrCoveragePct: coveragePct,
		mttrReady: ready,
		mttrMinSample: minSample,
		mttrMinCoveragePct: minCoveragePct
	};
}

const num = (v: unknown, fb: number) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : fb);

/** Ambang dari app_settings (1 query). Gagal baca = dicatat + ambang bawaan. */
export async function loadMttrSettings(): Promise<MttrSettings> {
	try {
		const res = await directusServerJson<{ data: { setting_key: string; setting_value: string }[] }>(
			'/items/app_settings?filter[module][_eq]=kpi_engine&filter[setting_key][_in]=ess_mttr_min_sample,ess_mttr_min_coverage_pct&fields=setting_key,setting_value&limit=-1'
		);
		const map = Object.fromEntries((res?.data || []).map((r) => [r.setting_key, r.setting_value]));
		return {
			minSample: Math.max(1, Math.round(num(map.ess_mttr_min_sample, DEFAULT_MTTR_MIN_SAMPLE))),
			minCoveragePct: Math.max(0, Math.min(100, num(map.ess_mttr_min_coverage_pct, DEFAULT_MTTR_MIN_COVERAGE_PCT)))
		};
	} catch (e: any) {
		console.error('[ess/maintenanceMttr] gagal baca ambang MTTR, pakai bawaan:', e?.message);
		return { minSample: DEFAULT_MTTR_MIN_SAMPLE, minCoveragePct: DEFAULT_MTTR_MIN_COVERAGE_PCT };
	}
}
