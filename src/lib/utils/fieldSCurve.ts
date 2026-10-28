// src/lib/utils/fieldSCurve.ts
// Fase 6 / 6.3 (Pertajam Modul Penawaran) — dashboard lapangan: kurva RENCANA
// (Kurva S dari penawaran yang ditandatangani customer, disimpan di
// so_rab.scurve_baseline oleh erp-epi) vs REALISASI harian yang dilaporkan.
// Fungsi murni, tanpa dependensi — mirror gaya progressCalculator.ts.

export interface SCurvePoint {
	d: string; // tanggal_selesai minggu (YYYY-MM-DD)
	p: number; // bobot kumulatif rencana (%)
}

function toTime(v: string | Date | null | undefined): number {
	if (!v) return NaN;
	const d = v instanceof Date ? v : new Date(v);
	return d.getTime();
}

/**
 * % rencana pada tanggal `date`, interpolasi linear antar titik baseline.
 * Sebelum titik pertama → 0. Setelah titik terakhir → nilai terakhir (≈100).
 * Null bila baseline kosong/invalid (pemanggil sembunyikan kurva rencana).
 */
export function plannedPctAt(
	baseline: SCurvePoint[] | null | undefined,
	date: string | Date
): number | null {
	const pts = (Array.isArray(baseline) ? baseline : [])
		.filter((x) => x && x.d && Number.isFinite(Number(x.p)))
		.map((x) => ({ t: toTime(x.d), p: Number(x.p) }))
		.filter((x) => !Number.isNaN(x.t))
		.sort((a, b) => a.t - b.t);
	if (pts.length === 0) return null;

	const t = toTime(date);
	if (Number.isNaN(t)) return null;
	if (t <= pts[0].t) return 0;
	if (t >= pts[pts.length - 1].t) return Math.round(pts[pts.length - 1].p * 10) / 10;

	for (let i = 1; i < pts.length; i++) {
		if (t <= pts[i].t) {
			const f = pts[i].t === pts[i - 1].t ? 1 : (t - pts[i - 1].t) / (pts[i].t - pts[i - 1].t);
			return Math.round((pts[i - 1].p + (pts[i].p - pts[i - 1].p) * f) * 10) / 10;
		}
	}
	return Math.round(pts[pts.length - 1].p * 10) / 10;
}

/**
 * Deret realisasi KUMULATIF (%) per tanggal laporan — unit-aware, per-subtask, basis
 * SAMA dengan calculateProjectProgressPercentage() ($lib/utils/projectProgress.ts):
 * untuk tiap tanggal, kumulatif actual per subtask (dari progress_value ber-subtask_id
 * di seluruh laporan s.d. tanggal itu) dibagi volume TARGET subtask itu sendiri (bukan
 * target_progress proyek — satuan komersial SO, bisa "1 lot", beda dari satuan fisik
 * subtask), lalu dirata-rata per kategori dan antar kategori.
 *
 * Item progress TANPA subtask_id (aktivitas custom/freeform, tidak match subtask
 * manapun di timeline_planning) tidak bisa diatribusikan ke subtask manapun -- tidak
 * ikut dihitung, sama seperti batasan di calculateProjectProgressPercentage sendiri.
 *
 * Sebelumnya: total volume mentah SEMUA aktivitas (lintas satuan) ÷ target_progress
 * proyek (Bug Titik A/C, correction_plan_progress_unit_mismatch_lot_vs_m2 erp-epi-1).
 */
export function actualCumulativeSeries(
	reports: any[],
	project: any
): { d: string; p: number }[] {
	let planning = project?.timeline_planning;
	if (typeof planning === 'string') {
		try {
			planning = JSON.parse(planning);
		} catch {
			planning = null;
		}
	}
	const categories = (planning?.categories || []).filter((c: any) => (c?.subtasks || []).length > 0);
	if (categories.length === 0) return [];

	const knownSubtaskIds = new Set<string>();
	for (const cat of categories) for (const sub of cat.subtasks || []) if (sub?.id != null) knownSubtaskIds.add(sub.id);
	if (knownSubtaskIds.size === 0) return [];

	// progress_value per tanggal, per subtask_id
	const byDateSubtask = new Map<string, Map<string, number>>();
	for (const r of reports || []) {
		const d = r?.date ? String(r.date).substring(0, 10) : '';
		if (!d) continue;
		let items = r.progress;
		if (typeof items === 'string') {
			try {
				items = JSON.parse(items);
			} catch {
				items = [];
			}
		}
		if (!Array.isArray(items)) continue;
		for (const pi of items) {
			const subId = pi?.subtask_id;
			if (!subId || !knownSubtaskIds.has(subId)) continue;
			const val = parseFloat(pi?.progress_value) || 0;
			if (val <= 0) continue;
			if (!byDateSubtask.has(d)) byDateSubtask.set(d, new Map());
			const m = byDateSubtask.get(d)!;
			m.set(subId, (m.get(subId) || 0) + val);
		}
	}

	const dates = [...byDateSubtask.keys()].sort();
	if (dates.length === 0) return [];

	const cumulativeBySubtask = new Map<string, number>();
	const out: { d: string; p: number }[] = [];
	for (const d of dates) {
		const dayMap = byDateSubtask.get(d)!;
		for (const [subId, val] of dayMap) cumulativeBySubtask.set(subId, (cumulativeBySubtask.get(subId) || 0) + val);

		// Audit Timeline Ciketing Fase 2 — weighted-by-volume, port dari erp-epi-1.
		let sumActual = 0;
		let sumVol = 0;
		for (const cat of categories) {
			const subtasks = cat.subtasks || [];
			for (const sub of subtasks) {
				const vol = parseFloat(sub.volume) || 0;
				if (vol <= 0) continue;
				const actual = cumulativeBySubtask.get(sub.id) || 0;
				sumActual += Math.min(actual, vol);
				sumVol += vol;
			}
		}
		out.push({ d, p: sumVol > 0 ? Math.round((sumActual / sumVol) * 1000) / 10 : 0 });
	}
	return out;
}

export type SCurveTone = 'ahead' | 'ontrack' | 'behind' | 'na';

/**
 * Status "di atas / di bawah rencana" pada `date` (default hari ini).
 * @param tolerancePct selisih dalam pita ini dianggap "sesuai rencana"
 */
export function scurveGap(
	baseline: SCurvePoint[] | null | undefined,
	actualPct: number | null | undefined,
	date: string | Date = new Date(),
	tolerancePct = 5
): { deltaPct: number | null; label: string; tone: SCurveTone } {
	const planned = plannedPctAt(baseline, date);
	if (planned == null || actualPct == null) {
		return { deltaPct: null, label: 'Belum ada baseline rencana', tone: 'na' };
	}
	const delta = Math.round((actualPct - planned) * 10) / 10;
	if (delta >= tolerancePct) return { deltaPct: delta, label: `+${delta}% di atas rencana`, tone: 'ahead' };
	if (delta <= -tolerancePct) return { deltaPct: delta, label: `${delta}% di bawah rencana`, tone: 'behind' };
	return { deltaPct: delta, label: 'Sesuai rencana', tone: 'ontrack' };
}
