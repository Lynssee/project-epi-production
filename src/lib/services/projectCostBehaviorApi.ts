// src/lib/services/projectCostBehaviorApi.ts
// Penajaman Finance CVP — Fase 5 (Dashboard Lapangan).
//
// Sumber data: RAP/Aktualisasi + Pengajuan Anggaran + alokasi overhead — BUKAN General Ledger
// (cost_center_project_id di GL baru terisi ~0%). Semua read-only.
//
// Konsisten dgn pola app ini: nominal rupiah DISEMBUNYIKAN dari Project Leader kecuali admin
// membukanya lewat system_settings (project.field_bep.show_rupiah). Kartu selalu bisa
// menampilkan persen & rasio.

import { secureDirectusJson } from './secureDirectus';
import { getAktualisasiByProject } from './projectAktualisasiApi';
import { loadProjectSettings, getProjectSetting } from './projectSettings';

export interface ProjectCostPosition {
	project_id: number;
	variable_realized: number; // realisasi biaya variabel/langsung proyek (dari aktualisasi)
	rap_plafon: number; // total plafon RAP (project_budgets.planned_amount)
	remaining: number; // rap_plafon - variable_realized
	used_pct: number | null; // variable_realized / rap_plafon
	remaining_pct: number | null;
	burn_rate_per_day: number; // rata-rata pengeluaran/hari dalam jendela
	days_left: number | null; // remaining / burn_rate_per_day
	window_days: number;
	overhead_allocated: number; // dari project_cost_allocations (Fase 4)
	contract_billed: number; // Σ invoices.paid_amount proyek ini
	position_vs_bep: number | null; // (contract_billed - variable_realized) / overhead_allocated
	// flag tampilan
	show_rupiah: boolean;
	show_overhead_nominal: boolean;
	has_overhead: boolean;
}

async function sumAggregate(endpoint: string, sumField: string): Promise<number> {
	try {
		const res = await secureDirectusJson<{ data: any[] }>(endpoint);
		return Number(res?.data?.[0]?.sum?.[sumField] || 0);
	} catch {
		return 0;
	}
}

/**
 * Posisi biaya satu proyek untuk kartu lapangan.
 */
export async function getProjectCostPosition(projectId: number): Promise<ProjectCostPosition | null> {
	if (!projectId) return null;
	await loadProjectSettings().catch(() => {});

	const windowDays = Number(getProjectSetting('project.field_bep.burn_rate_window_days')) || 7;
	const showRupiah = getProjectSetting('project.field_bep.show_rupiah') === true;
	const showOverheadNominal =
		showRupiah && getProjectSetting('project.field_bep.show_overhead_nominal') === true;

	// 1) Aktualisasi (realisasi biaya variabel/langsung) + rincian tanggal untuk burn-rate.
	let variableRealized = 0;
	let burnPerDay = 0;
	try {
		const aktRes = await getAktualisasiByProject(projectId);
		const items: any[] = aktRes?.success ? aktRes.data || [] : [];
		variableRealized = items.reduce((s, i) => s + (parseFloat(i.actual_amount) || 0), 0);

		const cutoff = new Date();
		cutoff.setDate(cutoff.getDate() - windowDays);
		const windowSpend = items
			.filter((i) => {
				const d = new Date(i.aktualisasi_date || i.expense_date || 0);
				return !isNaN(d.getTime()) && d >= cutoff;
			})
			.reduce((s, i) => s + (parseFloat(i.actual_amount) || 0), 0);
		burnPerDay = windowSpend / windowDays;
	} catch {
		/* gagal-lunak */
	}

	// 2) Plafon RAP.
	let rapPlafon = 0;
	try {
		const filter = encodeURIComponent(JSON.stringify({ project_id: { _eq: projectId } }));
		const res = await secureDirectusJson<{ data: any[] }>(
			`/items/project_budgets?filter=${filter}&fields=planned_amount&limit=-1`
		);
		rapPlafon = (res?.data || []).reduce((s, r) => s + (Number(r.planned_amount) || 0), 0);
	} catch {
		/* gagal-lunak */
	}

	// 3) Overhead teralokasi (Fase 4).
	const overheadAllocated = await sumAggregate(
		`/items/project_cost_allocations?aggregate[sum]=allocated_amount` +
			`&filter[project_id][_eq]=${projectId}&filter[status][_neq]=reversed&limit=1`,
		'allocated_amount'
	);

	// 4) Nilai kontrak tertagih (paid).
	const contractBilled = await sumAggregate(
		`/items/invoices?aggregate[sum]=paid_amount&filter[project_id][_eq]=${projectId}&limit=1`,
		'paid_amount'
	);

	const remaining = rapPlafon - variableRealized;
	const usedPct = rapPlafon > 0 ? variableRealized / rapPlafon : null;
	const remainingPct = rapPlafon > 0 ? remaining / rapPlafon : null;
	const daysLeft = burnPerDay > 0 ? Math.max(0, remaining / burnPerDay) : null;
	const positionVsBep =
		overheadAllocated > 0 ? (contractBilled - variableRealized) / overheadAllocated : null;

	return {
		project_id: Number(projectId),
		variable_realized: variableRealized,
		rap_plafon: rapPlafon,
		remaining,
		used_pct: usedPct,
		remaining_pct: remainingPct,
		burn_rate_per_day: burnPerDay,
		days_left: daysLeft,
		window_days: windowDays,
		overhead_allocated: overheadAllocated,
		contract_billed: contractBilled,
		position_vs_bep: positionVsBep,
		show_rupiah: showRupiah,
		show_overhead_nominal: showOverheadNominal,
		has_overhead: overheadAllocated > 0
	};
}

// ── Peta perilaku biaya untuk badge di form pengeluaran/anggaran lapangan ──────────
// Rantai sudah ada: budget_category_config.coa_debit → chart_of_accounts.cost_behavior.
// Di-cache per sesi (peta kecil, jarang berubah).

let _behaviorByKategori: Record<string, string> | null = null;

export async function getCostBehaviorByKategoriBelanja(): Promise<Record<string, string>> {
	if (_behaviorByKategori) return _behaviorByKategori;
	const map: Record<string, string> = {};
	try {
		const catRes = await secureDirectusJson<{ data: any[] }>(
			`/items/budget_category_config?fields=kode,coa_debit,coa_debit_department,is_non_expense&limit=-1`
		);
		const cats = catRes?.data || [];
		const codes = [
			...new Set(
				cats.flatMap((c) => [c.coa_debit, c.coa_debit_department].filter(Boolean).map(String))
			)
		];
		const behaviorByCode: Record<string, string> = {};
		if (codes.length) {
			const coaRes = await secureDirectusJson<{ data: any[] }>(
				`/items/chart_of_accounts?filter[account_code][_in]=${codes.join(',')}&fields=account_code,cost_behavior&limit=-1`
			);
			for (const a of coaRes?.data || []) behaviorByCode[String(a.account_code)] = a.cost_behavior || 'NONE';
		}
		for (const c of cats) {
			if (c.is_non_expense) {
				map[c.kode] = 'NONE';
				continue;
			}
			const code = c.coa_debit || c.coa_debit_department;
			map[c.kode] = code ? behaviorByCode[String(code)] || 'NONE' : 'NONE';
		}
	} catch {
		/* gagal-lunak → peta kosong */
	}
	_behaviorByKategori = map;
	return map;
}

export const COST_BEHAVIOR_BADGE: Record<string, { label: string; cls: string; hint: string }> = {
	VARIABLE: {
		label: 'Biaya Variabel Proyek',
		cls: 'bg-emerald-100 text-emerald-800 border-emerald-200',
		hint: 'Langsung memotong margin kontribusi proyek yang sedang Anda pegang.'
	},
	FIXED: {
		label: 'Biaya Tetap',
		cls: 'bg-blue-100 text-blue-800 border-blue-200',
		hint: 'Beban tetap — tidak naik-turun mengikuti volume pekerjaan.'
	},
	SEMI_VARIABLE: {
		label: 'Semi-Variabel',
		cls: 'bg-amber-100 text-amber-800 border-amber-200',
		hint: 'Sebagian tetap, sebagian mengikuti pemakaian.'
	}
};
