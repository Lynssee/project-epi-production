// src/lib/utils/projectProgress.ts
// Port murni (read-only, tanpa dependensi lain) dari erp-epi-1
// src/lib/utils/projectUtils.js — dipakai untuk gerbang BA Wajib di Dashboard Lapangan
// (Auto-Generate BA — Fase 3, 16 Agustus 2026). Hanya bagian status/progress yang di-port,
// BUKAN seluruh projectUtils.js (banyak yang admin-only/tidak relevan di sini).

export function normalizeStatusKey(status: string | null | undefined): string {
	const s = (status || '').toLowerCase().trim();
	if (['on progress', 'on_progress', 'in_progress', 'active'].includes(s)) return 'on progress';
	if (['waiting', 'prepare', 'pending', 'menunggu verifikasi', 'menunggu_verifikasi'].includes(s)) return 'waiting';
	if (s === 'hold') return 'hold';
	if (['repair', 'rework'].includes(s)) return 'repair';
	if (s === 'draft') return 'draft';
	if (['selesai', 'completed', 'done', 'complete'].includes(s)) return 'selesai';
	if (['closed', 'cancelled', 'canceled'].includes(s)) return 'closed';
	if (s === 'ciketing') return 'ciketing';
	return s || 'unknown';
}

export function isTerminalStatus(status: string | null | undefined): boolean {
	return ['selesai', 'closed'].includes(normalizeStatusKey(status));
}

/**
 * Identik dengan computeHierarchicalSubtaskProgress() di erp-epi — jaga sinkron kalau diubah di sana.
 * Subtask diclamp 100% → rata-rata subtask per kategori → rata-rata antar-kategori, sehingga
 * item "1 lot" (mobilisasi) tidak merusak rata-rata pekerjaan m². Subtask wajib berbobot 0
 * dan 'external_prereq' dikecualikan dari progres fisik.
 */
export function computeHierarchicalSubtaskProgress(categories: any[]): number {
	let totalCatProgress = 0;
	let validCategoriesCount = 0;

	(categories || []).forEach((cat: any) => {
		const subtasks = (cat.subtasks || []).filter(
			(sub: any) =>
				sub.executor_type !== 'external_prereq' &&
				((parseFloat(sub.bobot_pct) || 0) !== 0 || !sub.wajib_key)
		);
		if (subtasks.length > 0) {
			let totalSubPct = 0;
			subtasks.forEach((sub: any) => {
				const actualVolume = Object.values(sub.daily_actual || {}).reduce((sum: number, val: any) => sum + (parseFloat(val) || 0), 0);
				const subVol = parseFloat(sub.volume) || 0;
				const planVol = Object.values(sub.daily_plan || {}).reduce((sum: number, val: any) => sum + (parseFloat(val) || 0), 0);
				const targetVol = subVol > 0 ? subVol : planVol > 0 ? planVol : 0;
				const subPct = targetVol > 0 ? Math.min(100, (actualVolume / targetVol) * 100) : actualVolume > 0 ? 100 : 0;
				totalSubPct += subPct;
			});
			totalCatProgress += totalSubPct / subtasks.length;
			validCategoriesCount++;
		}
	});

	return validCategoriesCount > 0 ? parseFloat((totalCatProgress / validCategoriesCount).toFixed(2)) : 0;
}

/** Identik dengan calculateProjectProgressPercentage() di erp-epi — jaga sinkron kalau diubah di sana. */
export function calculateProjectProgressPercentage(project: any): number {
	if (!project) return 0;

	if (isTerminalStatus(project.status)) return 100;

	let planning = project.timeline_planning;
	if (planning) {
		if (typeof planning === 'string') {
			try { planning = JSON.parse(planning); } catch { planning = null; }
		}
		const categories = planning?.categories || [];
		if (categories.length > 0) {
			const computed = computeHierarchicalSubtaskProgress(categories);
			if (computed > 0) return computed;
		}
	}

	// `total_progress` di DB sudah persentase 0-100 — jangan dibagi lagi dengan target_progress (volume).
	const total = parseFloat(project.total_progress) || 0;
	return Math.min(100, Math.max(0, total));
}

function isActivityMatch(activityName: string, reportActivity: string): boolean {
	if (!activityName || !reportActivity) return false;
	const normalize = (str: string) => String(str).toLowerCase().replace(/[^a-z0-9]/g, '');
	const n1 = normalize(activityName);
	const n2 = normalize(reportActivity);
	if (!n1 || !n2) return false;
	return n1.includes(n2) || n2.includes(n1);
}

/**
 * Menghitung akumulasi progres fisik proyek secara komprehensif:
 * menggabungkan riwayat laporan terdahulu + draft hari ini ke struktur timeline_planning subtasks.
 */
export function calculateCumulativeProjectProgress(
	project: any,
	allReports: any[] = [],
	todayItems: any[] = [],
	currentReportId: string | number | null = null
): number {
	if (!project) return 0;
	if (isTerminalStatus(project.status)) return 100;

	let planning = project.timeline_planning;
	if (planning && typeof planning === 'string') {
		try { planning = JSON.parse(planning); } catch { planning = null; }
	}

	const rawCategories = planning?.categories || [];
	if (rawCategories.length > 0) {
		const clonedCategories = rawCategories.map((cat: any) => ({
			...cat,
			subtasks: (cat.subtasks || []).map((sub: any) => ({
				...sub,
				daily_actual: { ...(sub.daily_actual || {}) }
			}))
		}));

		const subtaskMap = new Map<string, any>();
		const subtaskByName: { sub: any; catName: string }[] = [];
		for (const cat of clonedCategories) {
			for (const sub of cat.subtasks || []) {
				if (sub.id) subtaskMap.set(String(sub.id), sub);
				subtaskByName.push({ sub, catName: cat.name || '' });
			}
		}

		const matchSubtask = (item: any) => {
			if (item.subtask_id && subtaskMap.has(String(item.subtask_id))) {
				return subtaskMap.get(String(item.subtask_id));
			}
			const actName = item.activity || item.name || '';
			const catName = item.category || '';
			if (actName) {
				const found = subtaskByName.find(s => isActivityMatch(s.sub.name, actName));
				if (found) return found.sub;
			}
			if (catName) {
				const found = subtaskByName.find(s => isActivityMatch(s.catName, catName) || isActivityMatch(s.sub.name, catName));
				if (found) return found.sub;
			}
			return null;
		};

		// 1. Merge historical reports
		for (const r of allReports || []) {
			if (currentReportId && String(r.id) === String(currentReportId)) continue;
			const rDate = r.date ? String(r.date).substring(0, 10) : (r.date_created ? String(r.date_created).substring(0, 10) : 'hist');
			let items = r.progress;
			if (typeof items === 'string') {
				try { items = JSON.parse(items); } catch { items = []; }
			}
			if (Array.isArray(items)) {
				for (const pi of items) {
					const val = Number(pi.progress_value) || 0;
					if (val <= 0) continue;
					const sub = matchSubtask(pi);
					if (sub) {
						if (!sub.daily_actual) sub.daily_actual = {};
						sub.daily_actual[rDate] = (sub.daily_actual[rDate] || 0) + val;
					}
				}
			}
		}

		// 2. Merge today's items
		for (const pi of todayItems || []) {
			const val = Number(pi.progress_value) || 0;
			if (val <= 0) continue;
			const sub = matchSubtask(pi);
			if (sub) {
				if (!sub.daily_actual) sub.daily_actual = {};
				sub.daily_actual['__today__'] = (sub.daily_actual['__today__'] || 0) + val;
			}
		}

		const computed = computeHierarchicalSubtaskProgress(clonedCategories);
		if (computed > 0) return computed;
	}

	// Fallback jika tidak ada timeline_planning categories:
	let totalVolume = 0;
	for (const r of allReports || []) {
		if (currentReportId && String(r.id) === String(currentReportId)) continue;
		let items = r.progress;
		if (typeof items === 'string') {
			try { items = JSON.parse(items); } catch { items = []; }
		}
		if (Array.isArray(items)) {
			for (const pi of items) {
				totalVolume += Number(pi.progress_value) || 0;
			}
		}
	}
	for (const pi of todayItems || []) {
		totalVolume += Number(pi.progress_value) || 0;
	}

	const targetVol = parseFloat(project?.target_progress) || 0;
	if (targetVol > 0 && totalVolume > 0) {
		return parseFloat(Math.min(100, (totalVolume / targetVol) * 100).toFixed(2));
	}

	const total = parseFloat(project?.total_progress) || 0;
	return Math.min(100, Math.max(0, total));
}
