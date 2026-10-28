// src/lib/services/paStatusLapangan.ts
// Fase 5 (audit hidden cost #1051) — klien status PA menunggu persetujuan + alat menganggur untuk Project Leader.
// Nominal rupiah TIDAK PERNAH dimuat di sisi lapangan (keputusan Lead 12 Okt 2026).

import directus from './directus';
import { readItems } from '@directus/sdk';
import { getIdToken } from './secureDirectus';
import { fetchActiveLoansForProject } from './loanChecklist';
import { loadProjectSettings, getProjectSetting } from './projectSettings';
import { computeIdleLoans, type IdleLoan } from '$lib/utils/idleLoans';
import type { PaStatusResult } from '$lib/utils/paStatusLapangan';

export type PaStatusResponse = PaStatusResult & { warnings: string[]; generated_at: string };

export async function loadPaStatus(projectId: number | string): Promise<PaStatusResponse> {
	const token = await getIdToken();
	const res = await fetch(`/api/proyek/${encodeURIComponent(String(projectId))}/pa-status`, { headers: { Authorization: `Bearer ${token}` } });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const body = await res.json();
	if (!body?.success) throw new Error(body?.error || 'Gagal memuat status pengajuan anggaran');
	return body.data as PaStatusResponse;
}

/** Colek approver (proxy ke admin; guard pemohon/SLA/rate-limit 1x/24 jam ada di sisi admin). */
export async function remindApprover(approvalRequestId: string): Promise<{ success: boolean; message: string }> {
	const token = await getIdToken();
	const res = await fetch(`/api/pengajuan-anggaran-ingatkan?approvalRequestId=${encodeURIComponent(approvalRequestId)}`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}` }
	});
	const j = await res.json().catch(() => null);
	if (!res.ok) return { success: false, message: j?.message || `Gagal mengingatkan (HTTP ${res.status})` };
	return { success: !!j?.success, message: j?.message || '' };
}

const REPORT_LOOKBACK_DAYS = 21;

/**
 * Alat pinjaman aktif yang tidak muncul di laporan harian ≥ N hari (N = setelan `project.alat.idle_days`, default 5; ≤ 0 = mati).
 * Gagal baca = daftar kosong + log (bukan "tidak ada alat menganggur" yang menyesatkan di UI: pemanggil menerima `error`).
 */
export async function loadIdleLoans(projectId: number): Promise<{ idle: IdleLoan[]; activeCount: number; idleDays: number; error?: string }> {
	await loadProjectSettings().catch(() => {});
	const idleDays = Number(getProjectSetting('project.alat.idle_days')) || 0;
	try {
		const since = new Date(Date.now() - REPORT_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
		const [loans, reports] = await Promise.all([
			fetchActiveLoansForProject(projectId),
			directus.request(
				readItems('reports', { filter: { project_id: { _eq: projectId }, date: { _gte: since } }, fields: ['id', 'date', 'tools'], limit: -1 })
			) as Promise<any[]>
		]);
		return { idle: computeIdleLoans({ loans, reports, idleDays }), activeCount: loans.length, idleDays };
	} catch (e: any) {
		console.error('[paStatusLapangan] gagal memuat alat menganggur:', e?.message || e);
		return { idle: [], activeCount: 0, idleDays, error: 'Data alat menganggur gagal dimuat.' };
	}
}
