// Ringkasan lintas-domain per project untuk Dashboard/Beranda: RAP vs Aktualisasi,
// manpower, HSE, dokumen, dan barang/packing. Dipakai supaya user tidak perlu buka
// halaman detail project satu-satu untuk melihat status ringkas tiap project.
// Sengaja TIDAK memuat Nilai PO (so_customer.grand_total) — itu tetap khusus di detail page.

import { secureDirectusJson } from './secureDirectus';
import { getBatchedProjectHseCompleteness } from './hse';
import { getDokumenByProject } from './dokumenApi';
import { getPackingRequests } from './packingList';
import { AKTUALISASI_CATEGORIES } from './projectAktualisasiApi';
import { loadProjectSettings, getProjectSetting } from './projectSettings';

export interface ProjectSummary {
	rapTotal: number;
	aktualTotal: number;
	selisih: number;
	selisihPct: number | null;
	budgetStatus: 'sehat' | 'waspada' | 'kritis' | 'unknown';
	manpower: { uniqueWorkers: number; totalMDay: number; totalDays: number };
	hse: {
		ptwAktif: boolean;
		toolboxHariIni: boolean;
		insidenBelumSelesai: number;
		jsaBerlaku: boolean | null;
		completenessPct: number;
	};
	dokumenCount: number;
	barang: { pendingCount: number; totalCount: number };
}

function emptySummary(): ProjectSummary {
	return {
		rapTotal: 0,
		aktualTotal: 0,
		selisih: 0,
		selisihPct: null,
		budgetStatus: 'unknown',
		manpower: { uniqueWorkers: 0, totalMDay: 0, totalDays: 0 },
		hse: { ptwAktif: false, toolboxHariIni: false, insidenBelumSelesai: 0, jsaBerlaku: null, completenessPct: 0 },
		dokumenCount: 0,
		barang: { pendingCount: 0, totalCount: 0 }
	};
}

/** Total RAP (project_budgets.planned_amount, fallback qty×unit_price) per project, satu query batched. */
export async function getBatchedProjectRabTotals(projectIds: number[]): Promise<Map<number, number>> {
	const map = new Map<number, number>();
	if (projectIds.length === 0) return map;
	try {
		const res = await secureDirectusJson(
			`/items/project_budgets?filter[project_id][_in]=${projectIds.join(',')}&fields=project_id,planned_amount,qty,unit_price&limit=-1`
		);
		for (const b of res.data || []) {
			const pid = typeof b.project_id === 'object' ? b.project_id?.id : b.project_id;
			if (pid == null) continue;
			let amount = parseFloat(b.planned_amount || 0);
			if (amount === 0 && b.qty && b.unit_price) {
				amount = parseFloat(b.qty) * parseFloat(b.unit_price);
			}
			map.set(Number(pid), (map.get(Number(pid)) ?? 0) + (amount || 0));
		}
	} catch (err) {
		console.error('getBatchedProjectRabTotals error:', err);
	}
	return map;
}

/** Total aktualisasi (project_expenses.expense_amount/debit_amount) per project, satu query batched. */
export async function getBatchedAktualisasiTotals(projectIds: number[]): Promise<Map<number, number>> {
	const map = new Map<number, number>();
	if (projectIds.length === 0) return map;
	try {
		const res = await secureDirectusJson(
			`/items/project_expenses?filter[project_id][_in]=${projectIds.join(',')}&fields=project_id,expense_amount,debit_amount&limit=-1`
		);
		for (const e of res.data || []) {
			const pid = typeof e.project_id === 'object' ? e.project_id?.id : e.project_id;
			if (pid == null) continue;
			const amount = parseFloat(e.expense_amount || e.debit_amount || 0);
			map.set(Number(pid), (map.get(Number(pid)) ?? 0) + (amount || 0));
		}
	} catch (err) {
		console.error('getBatchedAktualisasiTotals error:', err);
	}
	return map;
}

/** Kelengkapan HSE per project — batched (Fase 4 audit performa 29 Sep 2026, lihat
 *  getBatchedProjectHseCompleteness di hse.ts): 4 query total utk semua project di
 *  halaman, bukan 4 query x N project. */
export async function getBatchedHseCompleteness(
	projectIds: number[]
): Promise<Map<number, ProjectSummary['hse']>> {
	const map = new Map<number, ProjectSummary['hse']>();
	if (projectIds.length === 0) return map;
	const raw = await getBatchedProjectHseCompleteness(projectIds);
	projectIds.forEach((id) => {
		const r = raw.get(id) ?? { ptwAktif: false, toolboxHariIni: false, insidenBelumSelesai: 0, jsaBerlaku: null as any };
		const checks = [r.ptwAktif, r.toolboxHariIni, r.jsaBerlaku === true];
		const completenessPct = Math.round((checks.filter(Boolean).length / checks.length) * 100);
		map.set(id, { ...r, completenessPct });
	});
	return map;
}

/** Jumlah dokumen ter-upload per project. dokumenApi menyimpan tag di description
 *  (bukan kolom project_id sungguhan) sehingga tidak bisa di-batch dengan satu query `_in`
 *  tanpa risiko _contains salah-cocok (mis. "project_doc:1" vs "project_doc:11") — dipanggil
 *  paralel per project agar tetap akurat. */
export async function getBatchedDokumenCounts(projectIds: number[]): Promise<Map<number, number>> {
	const map = new Map<number, number>();
	if (projectIds.length === 0) return map;
	const results = await Promise.all(
		projectIds.map((id) => getDokumenByProject(id).catch(() => ({ success: false, data: [] })))
	);
	projectIds.forEach((id, i) => {
		map.set(id, (results[i].data || []).length);
	});
	return map;
}

/** Status ringkas permintaan barang/packing per project (satu query batched via _in). */
export async function getBatchedPackingStatus(
	projectIds: number[]
): Promise<Map<number, ProjectSummary['barang']>> {
	const map = new Map<number, ProjectSummary['barang']>();
	if (projectIds.length === 0) return map;
	try {
		const rows = await getPackingRequests(projectIds, { limit: -1 } as any);
		for (const id of projectIds) map.set(id, { pendingCount: 0, totalCount: 0 });
		for (const r of rows as any[]) {
			const pid = Number(r.project_id);
			const entry = map.get(pid) ?? { pendingCount: 0, totalCount: 0 };
			entry.totalCount++;
			if (r.packing_status === 'requested' || r.packing_status === 'approved') entry.pendingCount++;
			map.set(pid, entry);
		}
	} catch (err) {
		console.error('getBatchedPackingStatus error:', err);
	}
	return map;
}

/**
 * Rekap manpower (pekerja unik + total M-Day) 30 hari terakhir per project, dihitung dari
 * data laporan yang SUDAH di-fetch lewat getBatchedReports (field `manpower`) — tidak
 * melakukan query tambahan, mengikuti logika yang sama dengan halaman detail project.
 */
export function computeManpowerRecapFromReports(
	reports: any[],
	projectIds: number[]
): Map<number, ProjectSummary['manpower']> {
	const map = new Map<number, ProjectSummary['manpower']>();
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - 30);

	for (const pid of projectIds) {
		const projectReports = reports
			.filter((r) => Number(r.project_id) === Number(pid))
			.filter((r) => {
				const created = r.date_created ? new Date(r.date_created) : null;
				return !created || created >= cutoff;
			});

		const uniqueWorkers = new Set<string>();
		let totalMDay = 0;
		for (const report of projectReports) {
			let mp = report.manpower;
			if (typeof mp === 'string') {
				try {
					mp = JSON.parse(mp);
				} catch {
					continue;
				}
			}
			if (!Array.isArray(mp)) continue;
			for (const group of mp) {
				totalMDay += Number(group.count) || 0;
				if (Array.isArray(group.workers)) {
					for (const w of group.workers) {
						const name = w?.nama || w?.name || (typeof w === 'string' ? w : null);
						if (name) uniqueWorkers.add(name);
					}
				}
			}
		}
		map.set(pid, { uniqueWorkers: uniqueWorkers.size, totalMDay, totalDays: projectReports.length });
	}
	return map;
}

/**
 * Orchestrator: ambil semua ringkasan per project sekaligus (batched per halaman,
 * bukan seluruh dataset), untuk dirender sebagai chip di card Dashboard/Beranda.
 * `reportsForManpower` adalah hasil `getBatchedReports(projectIds)` yang sama yang
 * dipakai dashboard untuk status "sudah/belum lapor hari ini" — dipakai ulang di sini.
 */
export async function getBatchedProjectSummaries(
	projectIds: number[],
	reportsForManpower: any[]
): Promise<Record<number, ProjectSummary>> {
	const out: Record<number, ProjectSummary> = {};
	if (projectIds.length === 0) return out;

	const [rabMap, aktMap, hseMap, dokMap, barangMap] = await Promise.all([
		getBatchedProjectRabTotals(projectIds),
		getBatchedAktualisasiTotals(projectIds),
		getBatchedHseCompleteness(projectIds),
		getBatchedDokumenCounts(projectIds),
		getBatchedPackingStatus(projectIds)
	]);
	const budgetHealthMap = await getBatchedProjectBudgetHealth(rabMap, aktMap, projectIds);
	const manpowerMap = computeManpowerRecapFromReports(reportsForManpower, projectIds);

	for (const pid of projectIds) {
		const summary = emptySummary();
		summary.rapTotal = rabMap.get(pid) ?? 0;
		summary.aktualTotal = aktMap.get(pid) ?? 0;
		summary.selisih = summary.rapTotal - summary.aktualTotal;
		summary.selisihPct = summary.rapTotal > 0 ? (summary.selisih / summary.rapTotal) * 100 : null;
		summary.budgetStatus = budgetHealthMap.get(pid)?.status ?? 'unknown';
		summary.manpower = manpowerMap.get(pid) ?? summary.manpower;
		summary.hse = hseMap.get(pid) ?? summary.hse;
		summary.dokumenCount = dokMap.get(pid) ?? 0;
		summary.barang = barangMap.get(pid) ?? summary.barang;
		out[pid] = summary;
	}
	return out;
}

/**
 * Ringkasan penyerapan budget SATU project (persentase saja, TANPA nilai Rupiah) —
 * dipakai oleh tab "Laporan Keuangan" project leader, konsisten dengan keputusan
 * lama app ini yang menyembunyikan angka finansial dari view leader (lihat
 * projectContract.ts). Sumber angka aslinya (rapTotal/aktualTotal) sama dengan
 * yang dipakai getBatchedProjectSummaries, hanya tidak diekspos ke UI.
 */
export interface ProjectBudgetHealth {
	usedPct: number | null; // aktualTotal/rapTotal * 100, null bila RAP belum diisi
	status: 'sehat' | 'waspada' | 'kritis' | 'unknown';
}

/** Ambang warning/kritis burn budget — satu sumber dengan admin (erp-epi-1) & rap-aktual
 *  (ProjectAktualisasiPanel.svelte), dibaca dari project.monitor.thresholds. Sebelumnya
 *  hardcode 85/100 di sini — beda dari 90/100 yang dipakai bagian lain aplikasi ini. */
async function getBudgetHealthThresholds(): Promise<{ warning: number; critical: number }> {
	await loadProjectSettings();
	const t = getProjectSetting('project.monitor.thresholds') || {};
	return { warning: t.cost_pct_warning ?? 90, critical: t.cost_pct_critical ?? 100 };
}

function budgetStatusFromPct(usedPct: number, thresholds: { warning: number; critical: number }): ProjectBudgetHealth['status'] {
	if (usedPct >= thresholds.critical) return 'kritis';
	if (usedPct >= thresholds.warning) return 'waspada';
	return 'sehat';
}

export async function getProjectBudgetHealth(projectId: number): Promise<ProjectBudgetHealth> {
	const [rabMap, aktMap, thresholds] = await Promise.all([
		getBatchedProjectRabTotals([projectId]),
		getBatchedAktualisasiTotals([projectId]),
		getBudgetHealthThresholds()
	]);
	const rap = rabMap.get(projectId) ?? 0;
	const akt = aktMap.get(projectId) ?? 0;
	if (rap <= 0) return { usedPct: null, status: 'unknown' };
	const usedPct = (akt / rap) * 100;
	return { usedPct, status: budgetStatusFromPct(usedPct, thresholds) };
}

/** Versi batched untuk kartu ringkasan di Dashboard/Beranda — satu query settings untuk
 *  semua project sekaligus, dipanggil dari getBatchedProjectSummaries (bukan N kali). */
export async function getBatchedProjectBudgetHealth(
	rabMap: Map<number, number>,
	aktMap: Map<number, number>,
	projectIds: number[]
): Promise<Map<number, ProjectBudgetHealth>> {
	const thresholds = await getBudgetHealthThresholds();
	const map = new Map<number, ProjectBudgetHealth>();
	for (const pid of projectIds) {
		const rap = rabMap.get(pid) ?? 0;
		const akt = aktMap.get(pid) ?? 0;
		if (rap <= 0) { map.set(pid, { usedPct: null, status: 'unknown' }); continue; }
		const usedPct = (akt / rap) * 100;
		map.set(pid, { usedPct, status: budgetStatusFromPct(usedPct, thresholds) });
	}
	return map;
}

export { AKTUALISASI_CATEGORIES };
