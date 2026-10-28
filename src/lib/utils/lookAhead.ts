// Timeline & Scope Management Fase 3 — Look-Ahead rolling 2/4 minggu.
// Logika identik dengan erp-epi-1/src/lib/utils/lookAhead.js (duplikasi disengaja).

import { formatDateKey } from './workingDays';

export interface UpcomingSubtask {
	categoryName: string;
	subtaskId: string;
	subtaskName: string;
	firstPlanDate: string;
	lastPlanDate: string;
	progressPct: number;
}

function getPlanRange(sub: any): { first: string; last: string } | null {
	const keys = Object.keys(sub?.daily_plan || {}).filter((k) => sub.daily_plan[k] > 0);
	if (keys.length === 0) return null;
	const sorted = keys.sort();
	return { first: sorted[0], last: sorted[sorted.length - 1] };
}

function getProgressPct(sub: any): number {
	const totalActual = Object.values(sub?.daily_actual || {}).reduce(
		(s: number, v: any) => s + (parseFloat(v) || 0),
		0
	);
	const vol = parseFloat(sub?.volume) || 0;
	if (vol === 0) return 0;
	return Math.min(100, (totalActual / vol) * 100);
}

/** @param windowDays - 14 (2 minggu) atau 28 (4 minggu) */
export function getUpcomingSubtasks(categories: any[], windowDays: number): UpcomingSubtask[] {
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const todayKey = formatDateKey(today);
	const windowEnd = new Date(today);
	windowEnd.setDate(windowEnd.getDate() + windowDays);
	const windowEndKey = formatDateKey(windowEnd);

	const result: UpcomingSubtask[] = [];
	for (const cat of categories || []) {
		for (const sub of cat.subtasks || []) {
			const range = getPlanRange(sub);
			if (!range) continue;
			if (range.first > windowEndKey || range.last < todayKey) continue;
			result.push({
				categoryName: cat.name,
				subtaskId: sub.id,
				subtaskName: sub.name,
				firstPlanDate: range.first,
				lastPlanDate: range.last,
				progressPct: getProgressPct(sub)
			});
		}
	}
	return result.sort((a, b) => a.firstPlanDate.localeCompare(b.firstPlanDate));
}
