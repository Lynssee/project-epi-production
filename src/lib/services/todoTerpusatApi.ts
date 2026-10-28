// src/lib/services/todoTerpusatApi.ts
// Fase 6 To-Do/Approval Center Teragregasi (lapangan) — gabung 3 sumber lintas proyek:
// (1) review maintenance -- SATU-SATUNYA yang genuinely actionable oleh leader; (2) status
// laporan harian -- info read-only, approval-nya sengaja belum diaktifkan; (3) kasbon manpower
// -- info read-only, leader ADALAH approver saat submit jadi tidak ada aksi menunggu di sini.
// Semua reuse fungsi service existing, TIDAK menulis ulang query/logic yang sudah ada.

import directus, { handleDirectusError } from './directus';
import { readItems } from '@directus/sdk';
import { getActiveEquipmentIds, getMekanikActivitiesForReview, type MekanikActivityForReview } from './plDashboard';
import { getBatchedReports } from './reports';
import { getKasbonManpowerForProjects, type KasbonManpowerRow } from './kasbonManpowerTerpusat';

export interface MaintenanceReviewRow extends MekanikActivityForReview {
	projectId: number | null;
	projectName: string;
}

/** Review maintenance pending, lintas proyek yang di-scope user (getProjectsForCurrentUser).
 *  Reuse getActiveEquipmentIds + getMekanikActivitiesForReview (plDashboard.ts) apa adanya --
 *  tambahan di sini cuma peta equipment->proyek supaya tiap baris tahu proyeknya. */
export async function getMaintenanceReviewForProjects(
	projects: { id: number; name: string }[]
): Promise<MaintenanceReviewRow[]> {
	const projectIds = projects.map((p) => p.id);
	if (projectIds.length === 0) return [];
	try {
		const equipmentRows = (await directus.request(
			readItems('project_equipment', {
				filter: { project_id: { _in: projectIds }, demobilization_date: { _null: true } },
				fields: ['equipment_id', 'project_id'],
				limit: -1
			})
		)) as any[];
		const equipmentToProject = new Map<string, number>();
		for (const r of equipmentRows) {
			if (r.equipment_id) equipmentToProject.set(String(r.equipment_id), r.project_id);
		}
		const equipmentIds = await getActiveEquipmentIds(projectIds);
		const activities = await getMekanikActivitiesForReview(equipmentIds, 'pending');
		const projectNameById = new Map(projects.map((p) => [p.id, p.name]));

		return activities.map((a) => {
			const projectId = equipmentToProject.get(String(a.equipmentId)) ?? null;
			return {
				...a,
				projectId,
				projectName: projectId != null ? projectNameById.get(projectId) || `Proyek #${projectId}` : '-'
			};
		});
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export interface LaporanHarianStatusRow {
	projectId: number;
	projectName: string;
	belumApproved: number;
}

/** Ringkasan status laporan harian per proyek (30 hari terakhir) -- INFO read-only, tidak ada
 *  aksi approve dari sini (mirror ke Universal Approval Engine sengaja belum aktif). */
export async function getLaporanHarianStatusForProjects(
	projects: { id: number; name: string }[]
): Promise<LaporanHarianStatusRow[]> {
	const projectIds = projects.map((p) => p.id);
	if (projectIds.length === 0) return [];
	const today = new Date();
	const start = new Date(today);
	start.setDate(start.getDate() - 30);
	const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

	const reports = await getBatchedReports(projectIds, {
		startDate: toDateStr(start),
		endDate: toDateStr(today),
		fields: ['id', 'project_id', 'date', 'status']
	});

	const counts = new Map<number, number>();
	for (const r of reports as any[]) {
		if (r.status === 'approved') continue;
		counts.set(r.project_id, (counts.get(r.project_id) || 0) + 1);
	}

	return projects
		.map((p) => ({ projectId: p.id, projectName: p.name, belumApproved: counts.get(p.id) || 0 }))
		.filter((r) => r.belumApproved > 0);
}

/** Kasbon manpower belum lunas -- INFO read-only ("menunggu Admin Proyek"), reuse Fase 5 apa
 *  adanya. Leader tidak punya aksi approve di sini (lihat catatan di header file). */
export async function getKasbonManpowerInfoForProjects(projectIds: number[]): Promise<KasbonManpowerRow[]> {
	const rows = await getKasbonManpowerForProjects(projectIds);
	return rows.filter((k) => k.payment_status !== 'lunas');
}
