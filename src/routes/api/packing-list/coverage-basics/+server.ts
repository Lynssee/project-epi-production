// src/routes/api/packing-list/coverage-basics/+server.ts
// Bahan hitung kalkulator kewajaran qty LIVE di form Packing List lapangan (Rencana Gate Rasionalitas PL, Fase 4).
// Satu panggilan per proyek; selanjutnya form menghitung sendiri di browser (engine salinan identik erp-epi) — nol
// panggilan API per ketukan. Hanya baca & informatif: penegakan resmi tetap gate-precheck / submit. Gagal => success:false.
//   GET ?project_id=123
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';
import { loadFieldCoverage } from '$lib/server/gates/plFieldCoverageLoader';

const mapToObj = (m: Map<string, unknown>) => Object.fromEntries(m);

export async function GET(event: RequestEvent) {
	await requireUser(event);
	const projectId = event.url.searchParams.get('project_id');
	if (!projectId || !/^\d+$/.test(projectId)) return json({ success: false, error: 'project_id wajib (angka)' }, { status: 400 });
	try {
		const c = await loadFieldCoverage(projectId, [], directusServerJson);
		return json({
			success: true,
			settings: c.settings,
			rates: c.rates,
			area: c.area,
			dailyRate: c.dailyRate,
			priorByRateId: mapToObj(c.priorByRateId),
			siteStockByRateId: mapToObj(c.siteStockByRateId)
		});
	} catch (e: any) {
		console.error(`[packing-list/coverage-basics] proyek ${projectId} gagal:`, e?.message || e);
		return json({ success: false, error: 'Gagal memuat bahan kalkulator kewajaran qty' }, { status: 500 });
	}
}
