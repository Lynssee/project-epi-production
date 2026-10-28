// src/lib/utils/dailyTarget.ts
// Kartu "Target Hari Ini vs Realisasi" di form Laporan Harian (Penyelarasan Progres Fisik &
// Deviasi — rekomendasi lapangan). Util MURNI: target = jumlah daily_plan[tanggal] per subtask
// (Kurva S), realisasi = volume yang sedang diinput di form untuk subtask yang sama. Dikelompokkan
// per satuan supaya 1 lot tidak dijumlah dengan m².

export type DailyTargetRow = { unit: string; target: number; realisasi: number; pct: number };

const num = (v: any) => parseFloat(v) || 0;

export function computeDailyTarget(
	project: any,
	dateKey: string,
	draftItems: Array<{ subtask_id?: string; progress_value?: any }>
): DailyTargetRow[] {
	let planning = project?.timeline_planning;
	if (typeof planning === 'string') {
		try { planning = JSON.parse(planning); } catch { planning = null; }
	}
	const rows = new Map<string, { target: number; realisasi: number }>();
	const get = (unit: string) => {
		if (!rows.has(unit)) rows.set(unit, { target: 0, realisasi: 0 });
		return rows.get(unit)!;
	};

	const draftBySub = new Map<string, number>();
	for (const pi of draftItems || []) {
		if (!pi?.subtask_id) continue;
		draftBySub.set(pi.subtask_id, (draftBySub.get(pi.subtask_id) || 0) + num(pi.progress_value));
	}

	for (const cat of planning?.categories || []) {
		for (const sub of cat.subtasks || []) {
			if (sub.executor_type === 'external_prereq') continue;
			const unit = String(sub.unit || cat.unit || 'm²');
			const planToday = num(sub.daily_plan?.[dateKey]);
			const done = draftBySub.get(sub.id) || 0;
			if (planToday <= 0 && done <= 0) continue;
			const row = get(unit);
			row.target += planToday;
			row.realisasi += done;
		}
	}

	return [...rows.entries()]
		.filter(([, r]) => r.target > 0)
		.map(([unit, r]) => ({
			unit,
			target: parseFloat(r.target.toFixed(2)),
			realisasi: parseFloat(r.realisasi.toFixed(2)),
			pct: Math.min(100, Math.round((r.realisasi / r.target) * 100))
		}))
		.sort((a, b) => b.target - a.target);
}
