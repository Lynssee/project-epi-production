// src/lib/server/ess/kpiDispute.ts
// Fase 11a (KPI Terpadu — Dispute Window, keputusan Q10). Karyawan boleh ajukan
// keberatan HANYA atas scorecard yang periodenya sudah dirilis (kpi_period.cutoff_status
// = 'released') — dicek di endpoint, bukan cuma dipercaya dari client.

import { directusServerJson } from '$lib/server/directus';

export interface KpiDispute {
	id: string;
	scorecard_id: string;
	karyawan_id: string;
	alasan: string;
	status: string;
	tanggapan_hrd: string | null;
	tanggal_dibuat: string;
}

export async function listMyDisputes(karyawanId: number): Promise<KpiDispute[]> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		fields: 'id,scorecard_id,karyawan_id,alasan,status,tanggapan_hrd,tanggal_dibuat',
		sort: '-tanggal_dibuat',
		limit: '-1'
	});
	const result = await directusServerJson<{ data: KpiDispute[] }>(`/items/kpi_dispute?${query.toString()}`);
	return result?.data || [];
}

/** true bila scorecard ini milik karyawan tsb DAN periodenya sudah 'released'. */
export async function canDisputeScorecard(karyawanId: number, scorecardId: string): Promise<boolean> {
	const query = new URLSearchParams({
		'filter[id][_eq]': scorecardId,
		'filter[karyawan_id][_eq]': String(karyawanId),
		'filter[status][_eq]': 'Finalized',
		fields: 'id,kpi_period_id'
	});
	const result = await directusServerJson<{ data: { id: string; kpi_period_id: string | null }[] }>(
		`/items/kpi_management?${query.toString()}`
	);
	const sc = result?.data?.[0];
	if (!sc?.kpi_period_id) return false;
	const periodRes = await directusServerJson<{ data: { cutoff_status: string | null }[] }>(
		`/items/kpi_period?filter[id][_eq]=${sc.kpi_period_id}&fields=cutoff_status`
	);
	return periodRes?.data?.[0]?.cutoff_status === 'released';
}

export async function submitDispute(karyawanId: number, scorecardId: string, alasan: string): Promise<KpiDispute> {
	const result = await directusServerJson<{ data: KpiDispute }>('/items/kpi_dispute', {
		method: 'POST',
		body: JSON.stringify({
			scorecard_id: scorecardId,
			karyawan_id: String(karyawanId),
			alasan,
			status: 'diajukan'
		})
	});
	return result.data;
}
