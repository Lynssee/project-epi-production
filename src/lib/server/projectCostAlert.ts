// src/lib/server/projectCostAlert.ts
// R8 (Forecast Keuangan Global, rekomendasi laporan) — alert WA ke Project Leader saat
// realisasi biaya proyek mendekati/melewati plafon RAP. Batch (bukan loop per-proyek),
// koleksi TERPISAH (Aturan #1/#2 CLAUDE.md), sumber SAMA dengan getProjectCostPosition()
// (projectCostBehaviorApi.ts) supaya angka yang PL lihat di kartu BEP dan yang memicu WA
// TIDAK PERNAH beda — bukan engine kedua yang bisa drift.
//
// Cooldown: sekali alert terkirim untuk satu proyek, tidak diulang sampai `cooldownDays`
// berlalu ATAU used_pct naik signifikan lagi (>=5 poin dari terakhir alert) — supaya PL yang
// proyeknya memang lama di atas ambang tidak di-spam WA tiap hari cron jalan.

import { directusServerJson } from '$lib/server/directus';

const TERMINAL_STATUSES = ['selesai', 'closed', 'cancel', 'cancelled', 'complete', 'done'];

export interface CostAlertCandidate {
	project_id: number;
	project_name: string;
	leader_id: number | null;
	used_pct: number;
	rap_plafon: number;
	realisasi: number;
}

async function fetchThresholdSettings(): Promise<{ thresholdPct: number; cooldownDays: number }> {
	let thresholdPct = 80;
	let cooldownDays = 7;
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/system_settings?filter[setting_key][_in]=project.cost_alert.threshold_pct,project.cost_alert.cooldown_days&fields=setting_key,setting_value&limit=-1`
		);
		for (const row of res?.data || []) {
			const val = typeof row.setting_value === 'string' ? JSON.parse(row.setting_value) : row.setting_value;
			if (row.setting_key === 'project.cost_alert.threshold_pct' && Number.isFinite(Number(val))) thresholdPct = Number(val);
			if (row.setting_key === 'project.cost_alert.cooldown_days' && Number.isFinite(Number(val))) cooldownDays = Number(val);
		}
	} catch {
		/* pakai default */
	}
	return { thresholdPct, cooldownDays };
}

/**
 * Cari proyek aktif yang realisasi biayanya sudah >= threshold% dari plafon RAP, DAN belum
 * di-alert dalam cooldownDays terakhir (atau used_pct naik >=5 poin sejak alert terakhir).
 */
export async function findProjectsOverCostThreshold(): Promise<CostAlertCandidate[]> {
	const { thresholdPct, cooldownDays } = await fetchThresholdSettings();
	const thresholdFrac = thresholdPct / 100;

	// 1) Proyek aktif (bukan status terminal) — butuh leader_id untuk target WA.
	const projectsRes = await directusServerJson<{ data: any[] }>(
		`/items/projects?filter[status][_nin]=${TERMINAL_STATUSES.join(',')}&fields=id,name,leader_id&limit=-1`
	);
	const projects = projectsRes?.data || [];
	if (projects.length === 0) return [];
	const projectIds = projects.map((p) => p.id);

	// 2) Plafon RAP — koleksi TERPISAH.
	const budgetsRes = await directusServerJson<{ data: any[] }>(
		`/items/project_budgets?filter[project_id][_in]=${projectIds.join(',')}&fields=project_id,planned_amount&limit=-1`
	);
	const rapByProject = new Map<number, number>();
	for (const row of budgetsRes?.data || []) {
		const pid = Number(row.project_id);
		rapByProject.set(pid, (rapByProject.get(pid) || 0) + (Number(row.planned_amount) || 0));
	}

	// 3) Realisasi — koleksi TERPISAH. Pola SAMA getActualTotalsForProjects() client (tanpa
	//    filter is_received, konsisten dgn angka yang sudah tampil di ProjectBepTrackerCard).
	const expensesRes = await directusServerJson<{ data: any[] }>(
		`/items/project_expenses?filter[project_id][_in]=${projectIds.join(',')}&fields=project_id,expense_amount,debit_amount&limit=-1`
	);
	const realisasiByProject = new Map<number, number>();
	for (const row of expensesRes?.data || []) {
		const pid = Number(row.project_id);
		const amt = Number(row.expense_amount || row.debit_amount || 0);
		realisasiByProject.set(pid, (realisasiByProject.get(pid) || 0) + amt);
	}

	// 4) Log alert 7 hari terakhir — koleksi TERPISAH, dipakai cooldown.
	const cutoffIso = new Date(Date.now() - cooldownDays * 86400000).toISOString();
	const logRes = await directusServerJson<{ data: any[] }>(
		`/items/project_cost_alert_log?filter[project_id][_in]=${projectIds.join(',')}&filter[alerted_at][_gte]=${cutoffIso}&fields=project_id,used_pct,alerted_at&sort=-alerted_at&limit=-1`
	);
	const lastAlertByProject = new Map<number, { used_pct: number }>();
	for (const row of logRes?.data || []) {
		const pid = Number(row.project_id);
		if (!lastAlertByProject.has(pid)) lastAlertByProject.set(pid, { used_pct: Number(row.used_pct) || 0 });
	}

	const candidates: CostAlertCandidate[] = [];
	for (const p of projects) {
		const rapPlafon = rapByProject.get(p.id) || 0;
		if (rapPlafon <= 0) continue; // RAP belum diisi -> tidak bisa dihitung, bukan alarm palsu
		const realisasi = realisasiByProject.get(p.id) || 0;
		const usedPct = realisasi / rapPlafon;
		if (usedPct < thresholdFrac) continue;

		const lastAlert = lastAlertByProject.get(p.id);
		if (lastAlert && usedPct - lastAlert.used_pct < 0.05) continue; // masih dalam cooldown, belum naik signifikan

		candidates.push({
			project_id: p.id,
			project_name: p.name || `Proyek #${p.id}`,
			leader_id: p.leader_id != null ? Number(p.leader_id) : null,
			used_pct: Math.round(usedPct * 1000) / 1000,
			rap_plafon: rapPlafon,
			realisasi
		});
	}
	return candidates;
}

export async function logCostAlertSent(projectId: number, usedPct: number): Promise<void> {
	try {
		await directusServerJson('/items/project_cost_alert_log', {
			method: 'POST',
			body: JSON.stringify({ project_id: projectId, used_pct: usedPct, alerted_at: new Date().toISOString() })
		});
	} catch (e) {
		console.warn('[projectCostAlert] Gagal mencatat log alert:', e);
	}
}
