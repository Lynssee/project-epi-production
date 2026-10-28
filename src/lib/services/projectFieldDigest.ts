// Project Monthly Health Digest — Penajaman Laporan Bulanan v2 §5.1 (Fase E). 1 halaman
// ringkas untuk Project Leader/Mandor: anggaran aktual vs RAB, kepatuhan absensi regu,
// kesiapan alat pinjaman (P2H), sisa material. TIDAK menghitung ulang rumus yang sudah
// ada — reuse getProjectBudgetHealth (projectSummary.ts, sudah menyembunyikan Rupiah dari
// view leader sesuai keputusan lama app ini) & getLowStockBalancesForProjects
// (projectStockBalanceApi.ts, sumber sama dengan Stok Kritis Terpusat admin).

import directus, { handleDirectusError } from './directus';
import { readItems } from '@directus/sdk';
import { getProjectBudgetHealth, type ProjectBudgetHealth } from './projectSummary';
import { getLowStockBalancesForProjects, type LowStockBalanceRow } from './projectStockBalanceApi';
import { getP2hResultCategories } from './preventive';

export interface AttendanceCompliance {
	applicable: boolean; // false bila tidak ada manpower_assignment aktif di proyek ini
	compliancePct: number | null;
	activeWorkers: number;
	expectedWorkerDays: number;
	actualWorkerDays: number; // hadir=1, setengah_hari=0.5
	elapsedWorkingDays: number;
}

export interface EquipmentReadiness {
	applicable: boolean; // false bila tidak ada alat pinjaman aktif di proyek ini
	readinessPct: number | null;
	totalEquipment: number;
	goCount: number;
	noGoCount: number;
	notCheckedCount: number;
	items: Array<{ equipmentId: string; name: string; result: 'Go' | 'No-Go' | null; checkedAt: string | null }>;
}

export interface ProjectHealthDigest {
	projectId: number;
	period: string; // YYYY-MM
	budget: ProjectBudgetHealth;
	attendance: AttendanceCompliance;
	equipment: EquipmentReadiness;
	material: LowStockBalanceRow[];
	overallStatus: 'sehat' | 'perhatian' | 'kritis';
}

function daysInMonth(year: number, month: number): number {
	return new Date(year, month, 0).getDate();
}

/** Hari kalender yang sudah lewat dalam periode — dipakai sebagai denominator agar compliance
 *  bulan berjalan tidak tampak rendah palsu karena hari-hari yang belum tiba. Untuk periode
 *  yang sudah lewat penuh (bulan lalu), sama dengan daysInMonth. */
function elapsedDaysInPeriod(period: string): number {
	const [y, m] = period.split('-').map(Number);
	const total = daysInMonth(y, m);
	const now = new Date();
	const isCurrentMonth = now.getFullYear() === y && now.getMonth() + 1 === m;
	return isCurrentMonth ? Math.min(total, now.getDate()) : total;
}

export async function getAttendanceCompliance(projectId: number, period: string): Promise<AttendanceCompliance> {
	const empty: AttendanceCompliance = {
		applicable: false, compliancePct: null, activeWorkers: 0, expectedWorkerDays: 0, actualWorkerDays: 0, elapsedWorkingDays: 0
	};
	try {
		const [y, m] = period.split('-').map(Number);
		const from = `${period}-01`;
		const to = `${period}-${String(daysInMonth(y, m)).padStart(2, '0')}`;

		const assignments = (await directus.request(
			readItems('manpower_assignment', {
				filter: {
					project_id: { _eq: projectId },
					status: { _eq: 'aktif' },
					_or: [{ tanggal_selesai: { _null: true } }, { tanggal_selesai: { _gte: from } }],
					tanggal_mulai: { _lte: to }
				},
				fields: ['id'],
				limit: -1
			})
		)) as any[];

		const activeWorkers = assignments.length;
		if (activeWorkers === 0) return empty;

		const elapsed = elapsedDaysInPeriod(period);
		const elapsedTo = elapsed < daysInMonth(y, m) ? `${period}-${String(elapsed).padStart(2, '0')}` : to;

		const absensi = (await directus.request(
			readItems('manpower_absensi', {
				filter: { project_id: { _eq: projectId }, tanggal: { _gte: from, _lte: elapsedTo } },
				fields: ['status'],
				limit: -1
			})
		)) as any[];

		let actualWorkerDays = 0;
		for (const a of absensi) {
			if (a.status === 'hadir') actualWorkerDays += 1;
			else if (a.status === 'setengah_hari') actualWorkerDays += 0.5;
		}

		const expectedWorkerDays = activeWorkers * elapsed;
		const compliancePct = expectedWorkerDays > 0 ? Math.min(100, Number(((actualWorkerDays / expectedWorkerDays) * 100).toFixed(1))) : null;

		return { applicable: true, compliancePct, activeWorkers, expectedWorkerDays, actualWorkerDays, elapsedWorkingDays: elapsed };
	} catch (error) {
		handleDirectusError(error);
		return empty;
	}
}

export async function getEquipmentReadiness(projectId: number): Promise<EquipmentReadiness> {
	const empty: EquipmentReadiness = {
		applicable: false, readinessPct: null, totalEquipment: 0, goCount: 0, noGoCount: 0, notCheckedCount: 0, items: []
	};
	try {
		const loans = (await directus.request(
			readItems('internal_loan_log', {
				filter: { project_id: { _eq: projectId }, status: { _eq: '8d23640e-5726-4480-a9fb-693e3ea6c8fa' } }, // AKTIF
				fields: ['equipment_id.id', 'equipment_id.name'],
				limit: -1
			})
		)) as any[];
		if (!loans.length) return empty;

		const equipmentIds = [...new Set(loans.map((l) => l.equipment_id?.id).filter(Boolean))] as string[];
		const nameById = new Map(loans.map((l) => [l.equipment_id?.id, l.equipment_id?.name]));

		// Sesi P2H 7 hari terakhir — kesiapan dinilai dari cek TERBARU, bukan hari ini persis
		// (alat bisa dicek H-1/H-2 dan masih relevan utk digest bulanan, beda dari dashboard
		// harian operator yang butuh cek hari-ini-persis).
		const sevenDaysAgo = new Date();
		sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
		const fromDate = sevenDaysAgo.toISOString().slice(0, 10);

		const sessions = (await directus.request(
			readItems('p2h_session', {
				filter: { equipment_id: { _in: equipmentIds }, date: { _gte: fromDate } },
				fields: ['equipment_id', 'date', 'overall_result'],
				sort: ['-date'],
				limit: -1
			})
		)) as any[];

		const latestByEquipment = new Map<string, any>();
		for (const s of sessions) {
			if (!latestByEquipment.has(s.equipment_id)) latestByEquipment.set(s.equipment_id, s);
		}

		const { goId, noGoId } = await getP2hResultCategories().catch(() => ({ goId: null, noGoId: null }));

		let goCount = 0, noGoCount = 0, notCheckedCount = 0;
		const items = equipmentIds.map((eid) => {
			const session = latestByEquipment.get(eid);
			let result: 'Go' | 'No-Go' | null = null;
			if (session) {
				if (session.overall_result === goId) result = 'Go';
				else if (session.overall_result === noGoId) result = 'No-Go';
			}
			if (result === 'Go') goCount += 1;
			else if (result === 'No-Go') noGoCount += 1;
			else notCheckedCount += 1;
			return { equipmentId: eid, name: nameById.get(eid) || `Alat #${eid}`, result, checkedAt: session?.date || null };
		});

		const totalEquipment = equipmentIds.length;
		const readinessPct = totalEquipment > 0 ? Math.round((goCount / totalEquipment) * 100) : null;

		return { applicable: true, readinessPct, totalEquipment, goCount, noGoCount, notCheckedCount, items };
	} catch (error) {
		handleDirectusError(error);
		return empty;
	}
}

function deriveOverallStatus(digest: Omit<ProjectHealthDigest, 'overallStatus'>): 'sehat' | 'perhatian' | 'kritis' {
	if (digest.budget.status === 'kritis') return 'kritis';
	if (digest.equipment.applicable && digest.equipment.noGoCount > 0) return 'kritis';
	if (digest.material.some((m) => m.status === 'critical')) return 'kritis';

	if (digest.budget.status === 'waspada') return 'perhatian';
	if (digest.attendance.applicable && digest.attendance.compliancePct != null && digest.attendance.compliancePct < 70) return 'perhatian';
	if (digest.equipment.applicable && digest.equipment.notCheckedCount > 0) return 'perhatian';
	if (digest.material.some((m) => m.status === 'low')) return 'perhatian';

	return 'sehat';
}

/** Orchestrator — panggil semua blok paralel untuk 1 proyek/periode. */
export async function getProjectHealthDigest(projectId: number, period: string): Promise<ProjectHealthDigest> {
	const [budget, attendance, equipment, material] = await Promise.all([
		getProjectBudgetHealth(projectId),
		getAttendanceCompliance(projectId, period),
		getEquipmentReadiness(projectId),
		getLowStockBalancesForProjects([projectId])
	]);

	const partial = { projectId, period, budget, attendance, equipment, material };
	return { ...partial, overallStatus: deriveOverallStatus(partial) };
}
