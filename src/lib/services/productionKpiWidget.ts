// src/lib/services/productionKpiWidget.ts
// Widget "My Manufacturing KPI" (Fase 8, Pertajam KPI Marketing & Manufaktur v2).
// spk TIDAK punya field supervisor/PIC — widget ini menampilkan KPI departemen
// Production apa adanya (bukan personal per-supervisor), sesuai keputusan user
// 12 Agu 2026. Rumus SENGAJA direplikasi dari erp-epi-1
// src/routes/api/laporan/kpi/aggregate/+server.js (computeProductionKpis) karena
// endpoint itu ada di app/origin terpisah — bukan sumber kebenaran ganda yang
// disengaja, murni keterbatasan cross-app fetch. Kalau formula F1/F2/F3 di sana
// berubah, file ini perlu disinkronkan manual.

import directus from './directus';
import { readItems } from '@directus/sdk';

export interface ProductionKpiSummary {
	efficiency: number;
	defectRate: number;
	onTimeDelivery: number;
	periodLabel: string;
}

function monthRange(date = new Date()) {
	const y = date.getFullYear();
	const m = date.getMonth() + 1;
	const from = `${y}-${String(m).padStart(2, '0')}-01`;
	const lastDay = new Date(y, m, 0).getDate();
	const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
	return { from, to, label: `${y}-${String(m).padStart(2, '0')}` };
}

export async function fetchProductionKpiSummary(): Promise<ProductionKpiSummary | null> {
	const { from, to, label } = monthRange();
	try {
		const rows = (await directus.request(
			readItems('spk' as any, {
				filter: {
					status: { _in: ['completed', 'qc_pending'] },
					qc_test_completed_date: { _gte: from, _lte: `${to}T23:59:59` }
				} as any,
				fields: ['actual_quantity_produced', 'total_kg', 'jumlah_produksi', 'quality_status', 'qc_test_completed_date', 'production_deadline'],
				limit: -1
			})
		)) as any[];

		if (rows.length === 0) return { efficiency: 0, defectRate: 0, onTimeDelivery: 0, periodLabel: label };

		let effSum = 0;
		let effCount = 0;
		let defectCount = 0;
		let onTimeCount = 0;
		let onTimeTotal = 0;

		for (const r of rows) {
			const planned = Number(r.total_kg) || Number(r.jumlah_produksi) || 0;
			const actual = Number(r.actual_quantity_produced) || 0;
			if (planned > 0) {
				effSum += Math.min(200, (actual / planned) * 100);
				effCount += 1;
			}
			if (['rework', 'failed'].includes(r.quality_status)) defectCount += 1;
			if (r.production_deadline && r.qc_test_completed_date) {
				onTimeTotal += 1;
				if (new Date(r.qc_test_completed_date) <= new Date(r.production_deadline)) onTimeCount += 1;
			}
		}

		return {
			efficiency: effCount > 0 ? Number((effSum / effCount).toFixed(1)) : 0,
			defectRate: Number(((defectCount / rows.length) * 100).toFixed(1)),
			onTimeDelivery: onTimeTotal > 0 ? Number(((onTimeCount / onTimeTotal) * 100).toFixed(1)) : 0,
			periodLabel: label
		};
	} catch (err) {
		console.error('fetchProductionKpiSummary:', err);
		return null;
	}
}
