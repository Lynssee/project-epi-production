// src/lib/utils/criticalPath.ts
// Port murni CPM (forward/backward pass, Finish-to-Start) dari erp-epi/src/lib/utils/criticalPath.js
// agar Project Leader melihat penanda JALUR KRITIS di Timeline lapangan. JAGA TETAP SEJALAN dengan
// versi admin: subtask tanpa predecessor DAN tanpa successor tidak pernah ditandai kritis.

import { countWorkingDays, formatDateKey } from './workingDays';

export interface CpmResult {
	es: number | null;
	ef: number | null;
	ls: number | null;
	lf: number | null;
	float: number | null;
	critical: boolean;
}

function planKeys(sub: any): string[] {
	return Object.keys(sub?.daily_plan || {})
		.filter((k) => (Number(sub.daily_plan[k]) || 0) > 0)
		.sort();
}

function externalPrereqDuration(sub: any, wpw: number, holidays: Set<string>): number {
	if (sub.actual_ready_date && sub.target_ready_date) {
		return Math.max(1, countWorkingDays(sub.target_ready_date, sub.actual_ready_date, wpw, holidays));
	}
	if (sub.target_ready_date) {
		const today = formatDateKey(new Date());
		if (sub.target_ready_date > today) return Math.max(1, countWorkingDays(today, sub.target_ready_date, wpw, holidays));
		return Math.max(1, countWorkingDays(sub.target_ready_date, today, wpw, holidays));
	}
	return 1;
}

export function computeCriticalPath(
	categories: any[],
	{ workdaysPerWeek = 6, holidaySet = new Set<string>() }: { workdaysPerWeek?: number; holidaySet?: Set<string> } = {}
): Map<string, CpmResult> {
	const nodes = new Map<string, { id: string; predecessorId: string | null; duration: number }>();
	for (const cat of categories || []) {
		for (const sub of cat?.subtasks || []) {
			if (sub?.id == null) continue;
			let duration: number;
			if (sub.executor_type === 'external_prereq') {
				duration = externalPrereqDuration(sub, workdaysPerWeek, holidaySet);
			} else {
				const keys = planKeys(sub);
				duration = Math.max(1, keys.length ? countWorkingDays(keys[0], keys[keys.length - 1], workdaysPerWeek, holidaySet) : 0);
			}
			nodes.set(sub.id, { id: sub.id, predecessorId: sub.predecessorId || null, duration });
		}
	}

	const successors = new Map<string, string[]>();
	const inDegree = new Map<string, number>();
	for (const id of nodes.keys()) inDegree.set(id, 0);
	for (const n of nodes.values()) {
		if (n.predecessorId && nodes.has(n.predecessorId)) {
			if (!successors.has(n.predecessorId)) successors.set(n.predecessorId, []);
			successors.get(n.predecessorId)!.push(n.id);
			inDegree.set(n.id, (inDegree.get(n.id) || 0) + 1);
		}
	}

	const queue = [...nodes.keys()].filter((id) => inDegree.get(id) === 0);
	const order: string[] = [];
	const visited = new Set<string>();
	while (queue.length) {
		const id = queue.shift()!;
		if (visited.has(id)) continue;
		visited.add(id);
		order.push(id);
		for (const s of successors.get(id) || []) {
			inDegree.set(s, (inDegree.get(s) || 0) - 1);
			if (inDegree.get(s) === 0) queue.push(s);
		}
	}
	const cyclic = [...nodes.keys()].filter((id) => !visited.has(id));
	if (cyclic.length > 0) console.warn('[criticalPath] Cycle di rantai predecessor, dilewati:', cyclic);

	const es = new Map<string, number>();
	const ef = new Map<string, number>();
	for (const id of order) {
		const n = nodes.get(id)!;
		const pred = n.predecessorId && visited.has(n.predecessorId) ? n.predecessorId : null;
		const start = pred ? ef.get(pred)! : 0;
		es.set(id, start);
		ef.set(id, start + n.duration);
	}
	const projectDuration = order.length ? Math.max(...order.map((id) => ef.get(id)!)) : 0;

	const ls = new Map<string, number>();
	const lf = new Map<string, number>();
	for (let i = order.length - 1; i >= 0; i--) {
		const id = order[i];
		const n = nodes.get(id)!;
		const succ = (successors.get(id) || []).filter((s) => visited.has(s));
		const finish = succ.length ? Math.min(...succ.map((s) => ls.get(s)!)) : projectDuration;
		lf.set(id, finish);
		ls.set(id, finish - n.duration);
	}

	const result = new Map<string, CpmResult>();
	for (const id of order) {
		const n = nodes.get(id)!;
		const linked = !!n.predecessorId || (successors.get(id) || []).length > 0;
		const float = ls.get(id)! - es.get(id)!;
		result.set(id, { es: es.get(id)!, ef: ef.get(id)!, ls: ls.get(id)!, lf: lf.get(id)!, float, critical: linked && float === 0 });
	}
	for (const id of cyclic) result.set(id, { es: null, ef: null, ls: null, lf: null, float: null, critical: false });
	return result;
}
