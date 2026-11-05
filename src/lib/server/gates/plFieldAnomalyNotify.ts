// src/lib/server/gates/plFieldAnomalyNotify.ts
// SERVER-ONLY. Early warning anomali permintaan barang dari sisi LAPANGAN (Rencana Gate Rasionalitas PL, Fase 5+): saat leader menekan
// Ajukan dan qty melebihi plafon kewajaran sebesar ≥ `pkl_coverage.extreme_alert_pct` (default 150%; 0 = nonaktif), kirim event
// `pl_anomaly_detected` ke webhook n8n yang SAMA dengan sisi admin (erp-epi/src/lib/server/n8nPlAnomalyNotify.js; payload identik,
// source: 'field_submit'). Dihitung walau gate rasionalitas masih shadow (shadow tidak memuat konteks demi hemat API, jadi pemuatan
// dilakukan di sini HANYA bila webhook terkonfigurasi → tanpa webhook biaya API nol). Best-effort: tidak pernah melempar / menahan
// pengajuan. Dedupe 6 jam per kasus. URL webhook = rahasia server → env PL_ANOMALY_N8N_WEBHOOK_URL (fallback app_settings
// project.pl_anomaly_n8n_webhook_url).

import { env } from '$env/dynamic/private';
import { evaluateCoverage, evaluateRunRate } from '$lib/shared/materialCoverageEngine';
import { loadFieldCoverage } from './plFieldCoverageLoader';
import type { FieldPLRow } from './plFieldGates';

type Dx = (path: string, init?: any) => Promise<any>;

const DEDUPE_TTL_MS = 6 * 60 * 60 * 1000;
const URL_TTL_MS = 5 * 60 * 1000;
const sent = new Map<string, number>();
let urlCache: { v: string; at: number } | null = null;

export function resetFieldAnomalyNotifyState() {
	sent.clear();
	urlCache = null;
}

async function getWebhookUrl(dx: Dx): Promise<string | null> {
	if (env.PL_ANOMALY_N8N_WEBHOOK_URL) return env.PL_ANOMALY_N8N_WEBHOOK_URL;
	if (urlCache && Date.now() - urlCache.at < URL_TTL_MS) return urlCache.v || null;
	let v = '';
	try {
		const res = await dx(
			'/items/app_settings?filter[module][_eq]=project&filter[setting_key][_eq]=pl_anomaly_n8n_webhook_url&fields=setting_value&limit=1'
		);
		const raw = res?.data?.[0]?.setting_value;
		v = raw ? String(raw).trim() : '';
	} catch (e: any) {
		console.warn('[plFieldAnomalyNotify] gagal baca URL webhook (dilewati):', e?.message || e);
	}
	urlCache = { v, at: Date.now() };
	return v || null;
}

export interface FieldAnomaly {
	gate: string;
	nama: string;
	qty: number;
	unit: string;
	overPct: number;
	capStd: number;
	stdUnit: string;
	suggestedQty: number;
}

/** Murni. Kembaran collectAnomalies() sisi admin: hanya baris 'over' dengan overPct ≥ ambang; ambang ≤ 0/NaN ⇒ nonaktif. */
export function collectFieldAnomalies(res: { coverage?: any; runrate?: any }, thresholdPct: number): FieldAnomaly[] {
	const th = Number(thresholdPct);
	if (!(th > 0)) return [];
	const out: FieldAnomaly[] = [];
	const add = (gate: string, items: any[] | undefined) => {
		for (const r of items || []) {
			if (r?.status === 'over' && Number(r.overPct) >= th) {
				out.push({ gate, nama: r.nama_barang || '', qty: Number(r.qty) || 0, unit: r.unit || '', overPct: Number(r.overPct), capStd: r.capStd, stdUnit: r.stdUnit || '', suggestedQty: r.suggestedQty });
			}
		}
	};
	add('G_PKL_COVERAGE_M2', res?.coverage?.items);
	add('G_PKL_TIMELINE_RUNRATE', res?.runrate?.items);
	return out.sort((a, b) => b.overPct - a.overPct);
}

/**
 * Evaluasi + kirim untuk baris pengajuan lapangan. Tidak melempar; aman di-`void`.
 * Biaya API nol bila webhook belum dikonfigurasi (dicek lebih dulu).
 */
export async function notifyFieldAnomaly(
	rows: FieldPLRow[],
	dx: Dx,
	meta: { source?: string; firebaseUid?: string; sourceId?: number | string | null } = {}
): Promise<{ sent: boolean; reason?: string }> {
	try {
		const url = await getWebhookUrl(dx);
		if (!url) return { sent: false, reason: 'webhook_not_configured' };

		const byProject = new Map<string, FieldPLRow[]>();
		for (const r of rows || []) {
			if (!r?.project_id || !(Number(r.qty) > 0)) continue;
			const k = String(r.project_id);
			if (!byProject.has(k)) byProject.set(k, []);
			byProject.get(k)!.push(r);
		}
		let anySent = false;
		for (const [pid, prows] of byProject) {
			const cov = await loadFieldCoverage(pid, prows.map((r) => r.identitas_barang_id), dx);
			const th = Number(cov.settings?.extreme_alert_pct);
			if (!(th > 0) || !cov.area) continue;
			const items = prows
				.filter((r) => !(r.no_item_needed === true) && !(r.is_manpower === true))
				.map((r) => ({
					key: r.id,
					item_id: r.identitas_barang_id ?? null,
					nama_barang: r.material_name || '',
					qty_required: r.qty,
					unit: r.unit || '',
					fill_weight_kg: cov.fillById.get(String(r.identitas_barang_id)) ?? null
				}));
			const coverage = evaluateCoverage({ areaM2: cov.area.areaM2, items, rates: cov.rates, priorByRateId: cov.priorByRateId, settings: cov.settings });
			const runrate = cov.dailyRate
				? evaluateRunRate({ areaM2: cov.area.areaM2, dailyRate: cov.dailyRate, items, rates: cov.rates, siteStockByRateId: cov.siteStockByRateId, settings: cov.settings })
				: null;
			const anomalies = collectFieldAnomalies({ coverage, runrate }, th);
			if (!anomalies.length) continue;

			const key = `field|${pid}|${anomalies.map((a) => `${a.gate}:${a.nama}:${a.qty}`).join(',')}`;
			const prev = sent.get(key);
			if (prev && Date.now() - prev < DEDUPE_TTL_MS) continue;

			const body = {
				event: 'pl_anomaly_detected',
				source: meta.source || 'field_submit',
				packing_list_id: null,
				nomor_pl: null,
				project_id: Number(pid),
				area_m2: cov.area.areaM2,
				max_over_pct: Math.max(...anomalies.map((a) => a.overPct)),
				threshold_pct: th,
				items: anomalies.slice(0, 10),
				item_count: anomalies.length,
				link: null,
				source_row_id: meta.sourceId ?? null,
				triggered_at: new Date().toISOString(),
				source_app: 'project-epi'
			};
			try {
				const r = await fetch(url, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'X-Automated-By': 'project-epi-pl-anomaly' },
					body: JSON.stringify(body),
					signal: AbortSignal.timeout(5000)
				});
				if (r.ok) {
					sent.set(key, Date.now());
					anySent = true;
				}
			} catch (e: any) {
				console.warn('[plFieldAnomalyNotify] gagal mengirim webhook n8n (diabaikan):', e?.message || e);
			}
		}
		return { sent: anySent };
	} catch (e: any) {
		console.warn('[plFieldAnomalyNotify] evaluasi anomali gagal (diabaikan):', e?.message || e);
		return { sent: false, reason: 'error' };
	}
}
