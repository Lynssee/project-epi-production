// src/lib/services/siteCostStatementApi.ts
// Pemuat data Lembar Pertanggungjawaban Anggaran Lapangan. Memakai fungsi yang SUDAH dipakai ProjectAktualisasiPanel
// (RAP dari project_budgets, realisasi dari aktualisasi) + riwayat PA/PR proyek. Aturan #2: query dipisah per koleksi.
// Tidak membaca so_customer.subtotal/grand_total, invoice, atau laba — lembar ini bebas data komersial.

import { secureDirectusJson } from '$lib/services/secureDirectus';
import { getRABvsAktualisasi, AKTUALISASI_CATEGORIES, loadAktualisasiCategories } from '$lib/services/projectAktualisasiApi';
import { getRabItems, loadFullRab } from '$lib/services/soRabApi';
import { getPengajuanAnggaran } from '$lib/services/finance';
import { fetchProjectProcurementHistory } from '$lib/services/procurementApi';
import { loadProjectSettings, getProjectSetting } from '$lib/services/projectSettings';
import { buildSiteCostStatement, type SiteCostStatement } from '$lib/shared/siteCostStatement';

async function loadRabItems(project: any): Promise<any[]> {
	let items: any[] = [];
	const soId = typeof project.so_customer_id === 'object' ? project.so_customer_id?.id : project.so_customer_id;
	if (soId) {
		const res = await loadFullRab(soId);
		if (res.success && res.rab) {
			const r = await getRabItems(res.rab.id);
			if (r.success) items = [...items, ...r.data];
		}
	}
	const direct = await secureDirectusJson<any>(
		`/items/project_budgets?filter[project_id][_eq]=${project.id}&fields=id,budget_category,planned_amount,is_category_header,so_rab_id,project_id&limit=-1`
	);
	const seen = new Set(items.map((i) => i.id));
	return [...items, ...(direct?.data || []).filter((i: any) => !seen.has(i.id))];
}

export interface SiteCostStatementResult {
	statement: SiteCostStatement;
	/** Bagian yang gagal dimuat (ditampilkan di lembar; tidak diam-diam dianggap nol). */
	gagal: string[];
}

export async function loadSiteCostStatement(project: any): Promise<SiteCostStatementResult> {
	const gagal: string[] = [];
	const projectId = Number(project?.id);

	const [rabItems, pas, procurement] = await Promise.all([
		loadRabItems(project).catch((e) => {
			console.error('[siteCostStatement] RAP gagal dimuat', e);
			gagal.push('RAP');
			return [] as any[];
		}),
		getPengajuanAnggaran(500, { projectIds: [projectId] }).catch((e) => {
			console.error('[siteCostStatement] pengajuan anggaran gagal dimuat', e);
			gagal.push('Pengajuan Anggaran');
			return [] as any[];
		}),
		fetchProjectProcurementHistory(projectId).catch((e) => {
			console.error('[siteCostStatement] riwayat PR/PO gagal dimuat', e);
			gagal.push('Pengadaan PR/PO');
			return [] as any[];
		}),
		loadAktualisasiCategories(),
		loadProjectSettings().catch(() => null)
	]).then(([a, b, c]) => [a, b, c] as const);

	const comparisonRes = await getRABvsAktualisasi(projectId, rabItems);
	if (!comparisonRes.success) gagal.push('Realisasi aktual');

	const th: any = getProjectSetting('project.monitor.thresholds') || {};
	const statement = buildSiteCostStatement({
		comparison: comparisonRes.success ? comparisonRes.data : null,
		categories: AKTUALISASI_CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
		pas: pas as any[],
		procurement: procurement as any[],
		thresholds: { watch: th.cost_pct_watch, warning: th.cost_pct_warning, critical: th.cost_pct_critical }
	});
	return { statement, gagal };
}
