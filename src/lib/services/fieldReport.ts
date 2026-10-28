import directus, { handleDirectusError } from './directus';
import { readItems } from '@directus/sdk';
import { getProjects } from './projects';
import { getLeaderReportScore } from './reportScore';

export interface FieldReportKpis {
	proyekAktif: number;
	kepatuhanLaporan: number; // persentase 0-100
	materialDipakaiHariIni: number; // total qty dipakai hari ini (semua proyek)
	kebutuhanUrgentOpen: number; // packing request urgent yang masih 'requested'/'approved'
}

export interface StockMovementRow {
	projectId: number;
	projectName: string;
	masuk: number; // qty diterima (expense_type=supplier)
	keluar: number; // qty dipakai (expense_type=consumption)
	sisaSistem: number; // sum qty_remaining (supplier rows)
}

export interface PackingPipelineCount {
	requested: number;
	approved: number;
	delivered: number;
}

export interface UrgentNeedItem {
	id: number;
	projectId: number;
	projectName: string;
	materialName: string;
	qty: number;
	unit: string;
	packingStatus: string;
	requestedAt: string | null;
	daysOpen: number;
}

const todayStr = () => new Date().toISOString().split('T')[0];

/**
 * Ambil KPI ringkas untuk Field Reporting Dashboard.
 */
export async function getFieldReportKpis(): Promise<FieldReportKpis> {
	try {
		const projects = await getProjects(null, true, null, { filterStatus: 'active' });
		const projectList = (projects || []).map((p: any) => ({ id: p.id, name: p.name }));

		const [reportScore, consumptionToday, urgentOpen] = await Promise.all([
			getLeaderReportScore(projectList),
			directus.request(
				readItems('project_expenses', {
					filter: {
						expense_type: { _eq: 'consumption' },
						expense_date: { _eq: todayStr() }
					},
					fields: ['qty'],
					limit: -1
				})
			).catch(() => []),
			directus.request(
				readItems('project_budgets', {
					filter: {
						packing_status: { _in: ['requested', 'approved'] },
						note: { _icontains: 'urgent' }
					},
					fields: ['id'],
					limit: -1
				})
			).catch(() => [])
		]);

		const materialDipakaiHariIni = (consumptionToday || []).reduce(
			(sum: number, row: any) => sum + (Number(row.qty) || 0),
			0
		);

		return {
			proyekAktif: projectList.length,
			kepatuhanLaporan: reportScore.totalScore,
			materialDipakaiHariIni,
			kebutuhanUrgentOpen: (urgentOpen || []).length
		};
	} catch (error) {
		handleDirectusError(error);
		return { proyekAktif: 0, kepatuhanLaporan: 0, materialDipakaiHariIni: 0, kebutuhanUrgentOpen: 0 };
	}
}

/**
 * Pergerakan stok per proyek: masuk (delivered), keluar (dipakai), sisa sistem.
 */
export async function getStockMovements(limit = 100): Promise<StockMovementRow[]> {
	try {
		const [projects, expenses] = await Promise.all([
			getProjects(null, true, null, { filterStatus: 'active' }),
			directus.request(
				readItems('project_expenses', {
					filter: { expense_type: { _in: ['supplier', 'consumption'] } },
					fields: ['project_id.id', 'project_id.name', 'expense_type', 'qty', 'qty_remaining'],
					limit: -1
				})
			)
		]);

		const projectNameMap = new Map<number, string>((projects || []).map((p: any) => [p.id, p.name]));
		const byProject = new Map<number, StockMovementRow>();

		for (const row of expenses || []) {
			const pid = typeof row.project_id === 'object' ? row.project_id?.id : row.project_id;
			const pName = typeof row.project_id === 'object' ? row.project_id?.name : null;
			if (!pid) continue;
			if (!byProject.has(pid)) {
				byProject.set(pid, {
					projectId: pid,
					projectName: projectNameMap.get(pid) || pName || `Proyek #${pid}`,
					masuk: 0,
					keluar: 0,
					sisaSistem: 0
				});
			}
			const entry = byProject.get(pid)!;
			if (row.expense_type === 'supplier') {
				entry.masuk += Number(row.qty) || 0;
				entry.sisaSistem += Number(row.qty_remaining) || 0;
			} else if (row.expense_type === 'consumption') {
				entry.keluar += Number(row.qty) || 0;
			}
		}

		return Array.from(byProject.values())
			.sort((a, b) => b.keluar - a.keluar)
			.slice(0, limit);
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/**
 * Pipeline kebutuhan material: requested -> approved -> delivered.
 */
export async function getPackingPipeline(): Promise<PackingPipelineCount> {
	try {
		const result = await directus.request(
			readItems('project_budgets', {
				filter: { packing_status: { _nnull: true } },
				fields: ['packing_status'],
				limit: -1
			})
		);
		const counts: PackingPipelineCount = { requested: 0, approved: 0, delivered: 0 };
		for (const row of result || []) {
			if (row.packing_status === 'requested') counts.requested++;
			else if (row.packing_status === 'approved') counts.approved++;
			else if (row.packing_status === 'delivered') counts.delivered++;
		}
		return counts;
	} catch (error) {
		handleDirectusError(error);
		return { requested: 0, approved: 0, delivered: 0 };
	}
}

/**
 * Kebutuhan material urgent yang masih open (belum delivered), untuk alert.
 * Diisi otomatis oleh Directus Flow B saat leader submit laporan dengan urgency='urgent'.
 */
export async function getUrgentNeeds(): Promise<UrgentNeedItem[]> {
	try {
		const [projects, result] = await Promise.all([
			getProjects(null, true, null, { filterStatus: 'active' }),
			directus.request(
				readItems('project_budgets', {
					filter: {
						packing_status: { _in: ['requested', 'approved'] },
						note: { _icontains: 'urgent' }
					},
					fields: ['id', 'project_id.id', 'project_id.name', 'material_name', 'qty', 'unit', 'packing_status', 'requested_at'],
					sort: ['requested_at'],
					limit: -1
				})
			)
		]);

		const projectNameMap = new Map<number, string>((projects || []).map((p: any) => [p.id, p.name]));
		const now = Date.now();

		return (result || []).map((row: any) => {
			const pid = typeof row.project_id === 'object' ? row.project_id?.id : row.project_id;
			const pName = typeof row.project_id === 'object' ? row.project_id?.name : null;
			const requestedAt = row.requested_at ? new Date(row.requested_at) : null;
			const daysOpen = requestedAt ? Math.floor((now - requestedAt.getTime()) / (1000 * 60 * 60 * 24)) : 0;
			return {
				id: row.id,
				projectId: pid,
				projectName: projectNameMap.get(pid) || pName || `Proyek #${pid}`,
				materialName: row.material_name || '-',
				qty: Number(row.qty) || 0,
				unit: row.unit || '',
				packingStatus: row.packing_status,
				requestedAt: row.requested_at,
				daysOpen
			};
		});
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}
