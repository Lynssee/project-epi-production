// src/lib/utils/dailyTarget.ts
// Kartu "Target Hari Ini vs Realisasi" di form Laporan Harian (Penyelarasan Progres Fisik &
// Deviasi — rekomendasi lapangan). Util MURNI: target = jumlah daily_plan[tanggal] per subtask
// (Kurva S), realisasi = volume yang sedang diinput di form untuk subtask yang sama. Dikelompokkan
// per satuan supaya 1 lot tidak dijumlah dengan m².

export type DailyTargetRow = {
	unit: string;
	target: number;
	realisasi: number;
	pct: number;
	isEstimated?: boolean;
};

const num = (v: any) => parseFloat(v) || 0;

function toDateKey(value: any): string | null {
	const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value ?? ''));
	return m ? m[1] : null;
}

export function computeDailyTarget(
	project: any,
	dateKey: string,
	draftItems: Array<{ subtask_id?: string; progress_value?: any }>
): DailyTargetRow[] {
	let planning = project?.timeline_planning;
	if (typeof planning === 'string') {
		try { planning = JSON.parse(planning); } catch { planning = null; }
	}
	const rows = new Map<string, { target: number; realisasi: number; isEstimated: boolean }>();
	const get = (unit: string) => {
		if (!rows.has(unit)) rows.set(unit, { target: 0, realisasi: 0, isEstimated: false });
		return rows.get(unit)!;
	};

	const draftBySub = new Map<string, number>();
	for (const pi of draftItems || []) {
		if (!pi?.subtask_id) continue;
		draftBySub.set(pi.subtask_id, (draftBySub.get(pi.subtask_id) || 0) + num(pi.progress_value));
	}

	let hasAnyDailyPlan = false;
	const categories = planning?.categories || [];

	for (const cat of categories) {
		for (const sub of cat.subtasks || []) {
			if (sub.executor_type === 'external_prereq') continue;
			if (sub.daily_plan && Object.keys(sub.daily_plan).length > 0) {
				hasAnyDailyPlan = true;
			}
			const unit = String(sub.unit || cat.unit || 'm²');
			const planToday = num(sub.daily_plan?.[dateKey]);
			const done = draftBySub.get(sub.id) || 0;
			if (planToday <= 0 && done <= 0) continue;
			const row = get(unit);
			row.target += planToday;
			row.realisasi += done;
		}
	}

	// Fallback linier: Bila proyek belum memiliki rincian Kurva S harian (hasAnyDailyPlan === false),
	// tetapi memiliki jadwal start_date..end_date dan subtask volume (atau volume target kontrak).
	if (!hasAnyDailyPlan && project?.start_date && project?.end_date) {
		const startKey = toDateKey(project.start_date);
		const endKey = toDateKey(project.end_date);
		if (startKey && endKey && dateKey >= startKey && dateKey <= endKey) {
			const dayMs = 86400000;
			const totalDays = Math.max(1, Math.round((Date.parse(`${endKey}T00:00:00Z`) - Date.parse(`${startKey}T00:00:00Z`)) / dayMs) + 1);

			for (const cat of categories) {
				for (const sub of cat.subtasks || []) {
					if (sub.executor_type === 'external_prereq') continue;
					const subVol = num(sub.volume);
					if (subVol <= 0) continue;
					const unit = String(sub.unit || cat.unit || 'm²');
					const row = get(unit);
					row.target += parseFloat((subVol / totalDays).toFixed(2));
					row.isEstimated = true;
				}
			}

			// Jika categories kosong tapi project.target_progress ada:
			if (rows.size === 0 && num(project.target_progress) > 0) {
				const unit = 'vol';
				const row = get(unit);
				row.target = parseFloat((num(project.target_progress) / totalDays).toFixed(2));
				let totalDraft = 0;
				for (const pi of draftItems || []) totalDraft += num(pi.progress_value);
				row.realisasi = totalDraft;
				row.isEstimated = true;
			}
		}
	}

	return [...rows.entries()]
		.filter(([, r]) => r.target > 0)
		.map(([unit, r]) => {
			const res: DailyTargetRow = {
				unit,
				target: parseFloat(r.target.toFixed(2)),
				realisasi: parseFloat(r.realisasi.toFixed(2)),
				pct: Math.min(100, Math.round((r.realisasi / r.target) * 100))
			};
			if (r.isEstimated) res.isEstimated = true;
			return res;
		})
		.sort((a, b) => b.target - a.target);
}
