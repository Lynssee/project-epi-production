// src/lib/utils/manpowerPlan.ts
// Rencana manpower per subtask (`sub.manpower[]`, diisi admin di drawer spek Timeline) — Fase 3
// Integrasi Timeline <-> PL & Manpower. Salinan ringkas aturan dari erp-epi
// (src/lib/utils/forecast/manpowerPlan.js): per_hari = tiap hari aktif subtask, per_subtask =
// hari aktif PERTAMA saja. Hari aktif = daily_plan[tanggal] > 0. Util murni, tanpa I/O.

export interface ManpowerLine {
	role: string;
	qty: number;
	basis: 'per_hari' | 'per_subtask';
}

export function normalizeManpower(list: unknown): ManpowerLine[] {
	return (Array.isArray(list) ? list : [])
		.map((m: any) => ({
			role: String(m?.role ?? '').trim(),
			qty: Number(m?.qty) || 0,
			basis: (m?.basis === 'per_subtask' ? 'per_subtask' : 'per_hari') as ManpowerLine['basis']
		}))
		.filter((m) => m.role && m.qty > 0);
}

/** Total orang per hari aktif satu subtask (hanya baris per_hari) — untuk badge. */
export function subtaskDailyHeadcount(sub: any): number {
	return normalizeManpower(sub?.manpower)
		.filter((m) => m.basis === 'per_hari')
		.reduce((s, m) => s + m.qty, 0);
}

/** Kebutuhan seluruh subtask pada satu tanggal, dipecah per peran. */
export function plannedManpowerOn(categories: any[], dateKey: string): { total: number; byRole: Record<string, number> } {
	const byRole: Record<string, number> = {};
	let total = 0;
	for (const cat of categories || []) {
		for (const sub of cat?.subtasks || []) {
			const plan = normalizeManpower(sub?.manpower);
			if (plan.length === 0) continue;
			const dates = Object.keys(sub?.daily_plan || {})
				.filter((k) => (parseFloat(sub.daily_plan[k]) || 0) > 0)
				.sort();
			const idx = dates.indexOf(dateKey);
			if (idx < 0) continue;
			for (const m of plan) {
				if (m.basis === 'per_subtask' && idx > 0) continue;
				byRole[m.role] = (byRole[m.role] || 0) + m.qty;
				total += m.qty;
			}
		}
	}
	return { total, byRole };
}

/** Jumlah hadir pada tanggal tertentu dari laporan harian (report.manpower[].count; JSON string/array). */
export function attendedOn(reports: any[], dateKey: string): number | null {
	let found = false;
	let sum = 0;
	for (const r of reports || []) {
		if ((r?.date ? String(r.date).substring(0, 10) : '') !== dateKey) continue;
		let mp: any = r.manpower;
		if (typeof mp === 'string') {
			try { mp = JSON.parse(mp); } catch { mp = []; }
		}
		if (!Array.isArray(mp)) continue;
		found = true;
		sum += mp.reduce((s: number, m: any) => s + (Number(m?.count) || 0), 0);
	}
	return found ? sum : null;
}
