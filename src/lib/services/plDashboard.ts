// src/lib/services/plDashboard.ts
// PL Dashboard Fase 1 (blueprint modul maintenance, 18 Agu 2026) — KPI per proyek,
// review laporan mekanik, workload mekanik, dan jadwal PM, di-scope ke proyek yang
// dipimpin Project Leader yang login (projects.leader_id, lihat projectScope.ts).
//
// Rantai scoping: projects (leader_id = PL) -> project_equipment (aktif, demobilization_date
// null) -> equipment_id -> work_order / pm_due_tracker / p2h_session / mekanik_activity.
// Pola sama dengan getProjectEquipmentP2hStatus/getPmDueCountsMap di preventive.ts.

import directus, { handleDirectusError } from './directus';
import { readItems } from '@directus/sdk';
import { todayWib } from '$lib/utils/wibDate';
import { getPmDueCountsMap } from './preventive';

export interface LedProject {
	id: number;
	name: string;
}

/** Proyek yang leader_id atau nama leader-nya cocok dengan karyawan yang login. */
export async function getLedProjects(karyawanId: number | null, karyawanName: string | null): Promise<LedProject[]> {
	if (!karyawanId && !karyawanName) return [];
	try {
		const filter: any = { _or: [] };
		if (karyawanId) filter._or.push({ leader_id: { _eq: karyawanId } });
		if (karyawanName) filter._or.push({ leader: { _icontains: karyawanName } });
		return (await directus.request(
			readItems('projects', {
				filter,
				fields: ['id', 'name'],
				sort: ['name'],
				limit: -1
			})
		)) as LedProject[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/** Equipment yang sedang aktif ditugaskan (belum demobilisasi) ke proyek-proyek ini. */
export async function getActiveEquipmentIds(projectIds: number[]): Promise<string[]> {
	if (!projectIds.length) return [];
	try {
		const rows = (await directus.request(
			readItems('project_equipment', {
				filter: { project_id: { _in: projectIds }, demobilization_date: { _null: true } },
				fields: ['equipment_id'],
				limit: -1
			})
		)) as any[];
		return [...new Set(rows.map((r) => r.equipment_id).filter(Boolean))];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export interface PlKpi {
	woOpen: number;
	woInspection: number;
	woTotal: number;
	p2hDone: number;
	p2hEquipmentCount: number;
	pmOverdue: number;
	pmTotal: number;
}

/** KPI ringkas: WO by status, P2H compliance hari ini, PM overdue — untuk equipment yang di-scope. */
export async function getPlKpi(equipmentIds: string[]): Promise<PlKpi> {
	const empty: PlKpi = { woOpen: 0, woInspection: 0, woTotal: 0, p2hDone: 0, p2hEquipmentCount: 0, pmOverdue: 0, pmTotal: 0 };
	if (!equipmentIds.length) return empty;

	try {
		const [workOrders, statusCats, p2hSessions, pmMap] = await Promise.all([
			directus.request(
				readItems('work_order', {
					filter: { equipment_id: { _in: equipmentIds } },
					fields: ['id', 'order_status'],
					limit: -1
				})
			) as Promise<any[]>,
			directus.request(readItems('category', { filter: { group: { _eq: 'wo_status' } }, limit: -1 })) as Promise<any[]>,
			directus.request(
				readItems('p2h_session', {
					filter: { equipment_id: { _in: equipmentIds }, date: { _eq: todayWib() } },
					fields: ['id', 'equipment_id'],
					limit: -1
				})
			) as Promise<any[]>,
			getPmDueCountsMap(equipmentIds)
		]);

		const statusMap = new Map(statusCats.map((c) => [c.id, (c.name || '').toLowerCase()]));
		let woOpen = 0;
		let woInspection = 0;
		for (const wo of workOrders) {
			const statusName = statusMap.get(wo.order_status) || '';
			if (statusName.includes('closed')) continue;
			if (statusName === 'inspection') woInspection += 1;
			else woOpen += 1;
		}

		let pmOverdue = 0;
		let pmTotal = 0;
		for (const v of Object.values(pmMap)) {
			pmOverdue += v.overdue;
			pmTotal += v.total;
		}

		return {
			woOpen,
			woInspection,
			woTotal: workOrders.length,
			p2hDone: new Set(p2hSessions.map((s) => s.equipment_id)).size,
			p2hEquipmentCount: equipmentIds.length,
			pmOverdue,
			pmTotal
		};
	} catch (error) {
		handleDirectusError(error);
		return empty;
	}
}

export interface MekanikActivityForReview {
	id: string;
	tanggalInput: string;
	kegiatanRepair: string;
	kendala: string | null;
	remarks: string | null;
	sparepartRingkas: string | null;
	hoursmeter: number | null;
	durasiKerjaMenit: number | null;
	mekanikName: string;
	equipmentName: string;
	equipmentId: string;
	workOrderId: string;
	approvalStatus: 'pending' | 'approved' | 'rejected';
}

/** Laporan harian mekanik yang menunggu (atau sudah) direview, untuk equipment yang di-scope. */
export async function getMekanikActivitiesForReview(
	equipmentIds: string[],
	filter: 'pending' | 'all' = 'pending'
): Promise<MekanikActivityForReview[]> {
	if (!equipmentIds.length) return [];
	try {
		const directusFilter: any = { equipment_id: { _in: equipmentIds } };
		if (filter === 'pending') {
			directusFilter._or = [{ approval_status: { _eq: 'pending' } }, { approval_status: { _null: true } }];
		}
		const rows = (await directus.request(
			readItems('mekanik_activity', {
				filter: directusFilter,
				fields: [
					'id', 'tanggal_input', 'kegiatan_repair', 'kendala', 'remarks', 'sparepart_ringkas',
					'hoursmeter', 'durasi_kerja_menit', 'equipment_id', 'work_order_id', 'approval_status',
					'pic_id.name', 'equipment_id.name'
				],
				sort: ['-tanggal_input'],
				limit: -1
			})
		)) as any[];

		return rows.map((r) => ({
			id: r.id,
			tanggalInput: r.tanggal_input,
			kegiatanRepair: r.kegiatan_repair || '',
			kendala: r.kendala,
			remarks: r.remarks,
			sparepartRingkas: r.sparepart_ringkas,
			hoursmeter: r.hoursmeter,
			durasiKerjaMenit: r.durasi_kerja_menit,
			mekanikName: r.pic_id?.name || '-',
			equipmentName: r.equipment_id?.name || '-',
			equipmentId: typeof r.equipment_id === 'object' ? r.equipment_id?.id : r.equipment_id,
			workOrderId: r.work_order_id,
			approvalStatus: r.approval_status || 'pending'
		}));
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export interface MekanikWorkload {
	mekanikId: string;
	mekanikName: string;
	woAktif: number;
	woTotal: number;
}

/** Beban kerja per mekanik (WO aktif vs total) untuk equipment yang di-scope. */
export async function getWorkloadByMekanik(equipmentIds: string[]): Promise<MekanikWorkload[]> {
	if (!equipmentIds.length) return [];
	try {
		const [workOrders, statusCats] = await Promise.all([
			directus.request(
				readItems('work_order', {
					filter: { equipment_id: { _in: equipmentIds } },
					fields: ['id', 'order_status', 'pic_mekanik_1_id.id', 'pic_mekanik_1_id.name', 'pic_mekanik_2_id.id', 'pic_mekanik_2_id.name'],
					limit: -1
				})
			) as Promise<any[]>,
			directus.request(readItems('category', { filter: { group: { _eq: 'wo_status' } }, limit: -1 })) as Promise<any[]>
		]);

		const statusMap = new Map(statusCats.map((c) => [c.id, (c.name || '').toLowerCase()]));
		const byMekanik = new Map<string, MekanikWorkload>();

		const bump = (mekanik: any, aktif: boolean) => {
			if (!mekanik?.id) return;
			const key = String(mekanik.id);
			if (!byMekanik.has(key)) byMekanik.set(key, { mekanikId: key, mekanikName: mekanik.name || '-', woAktif: 0, woTotal: 0 });
			const entry = byMekanik.get(key)!;
			entry.woTotal += 1;
			if (aktif) entry.woAktif += 1;
		};

		for (const wo of workOrders) {
			const statusName = statusMap.get(wo.order_status) || '';
			const aktif = !statusName.includes('closed');
			bump(wo.pic_mekanik_1_id, aktif);
			bump(wo.pic_mekanik_2_id, aktif);
		}

		return [...byMekanik.values()].sort((a, b) => b.woAktif - a.woAktif);
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export interface PlPmScheduleItem {
	id: string;
	equipmentId: string;
	equipmentName: string;
	taskName: string;
	dueDate: string;
	overdue: boolean;
}

/** Jadwal PM (belum completed) untuk equipment yang di-scope, diurutkan due_date terdekat dulu. */
export async function getPmScheduleForEquipment(equipmentIds: string[]): Promise<PlPmScheduleItem[]> {
	if (!equipmentIds.length) return [];
	try {
		const today = todayWib();
		const chunkSize = 50;
		const trackers: any[] = [];
		for (let i = 0; i < equipmentIds.length; i += chunkSize) {
			const chunk = equipmentIds.slice(i, i + chunkSize);
			const result = (await directus.request(
				readItems('pm_due_tracker', {
					filter: { equipment_id: { _in: chunk } },
					fields: ['id', 'equipment_id', 'due_date', 'status_id', 'pm_task_template_id'],
					sort: ['due_date'],
					limit: -1
				})
			)) as any[];
			const list = Array.isArray(result) ? result : (result as any)?.data || [];
			trackers.push(...list);
		}

		if (!trackers.length) return [];

		const statusIds = [...new Set(trackers.map((t) => t.status_id).filter(Boolean))];
		const templateIds = [...new Set(trackers.map((t) => t.pm_task_template_id).filter(Boolean))];
		const eqIds = [...new Set(trackers.map((t) => t.equipment_id).filter(Boolean))];

		const [statuses, templates, equipments] = await Promise.all([
			statusIds.length
				? directus.request(readItems('category', { filter: { id: { _in: statusIds } }, fields: ['id', 'name'], limit: -1 }))
				: Promise.resolve([]),
			templateIds.length
				? directus.request(readItems('pm_task_template', { filter: { id: { _in: templateIds } }, fields: ['id', 'task_name'], limit: -1 }))
				: Promise.resolve([]),
			eqIds.length
				? directus.request(readItems('equipment', { filter: { id: { _in: eqIds } }, fields: ['id', 'name'], limit: -1 }))
				: Promise.resolve([])
		]);

		const statusList = Array.isArray(statuses) ? statuses : (statuses as any)?.data || [];
		const templateList = Array.isArray(templates) ? templates : (templates as any)?.data || [];
		const eqList = Array.isArray(equipments) ? equipments : (equipments as any)?.data || [];

		const statusMap = new Map(statusList.map((s: any) => [s.id, (s.name || '').toLowerCase()]));
		const templateMap = new Map(templateList.map((t: any) => [t.id, t.task_name]));
		const eqMap = new Map(eqList.map((e: any) => [e.id, e.name]));

		return trackers
			.filter((t: any) => String(statusMap.get(t.status_id) || '') !== 'completed')
			.map((t: any) => ({
				id: t.id,
				equipmentId: t.equipment_id,
				equipmentName: eqMap.get(t.equipment_id) || '-',
				taskName: templateMap.get(t.pm_task_template_id) || 'Tugas PM',
				dueDate: t.due_date,
				overdue: Boolean(t.due_date && t.due_date < today)
			}));
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}
