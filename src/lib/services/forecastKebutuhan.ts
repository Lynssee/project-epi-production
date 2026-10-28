// src/lib/services/forecastKebutuhan.ts
// Standarisasi Timeline Spek Teknis/BOM/Equipment & Mobilisasi Bertahap v2 (TAJAM), Fase 6
// (dashboard lapangan). Baca langsung koleksi `project_resource_forecast` lewat Directus SDK
// yang sudah dipakai project-epi untuk koleksi bersama lain (project_readiness_checks, dst) —
// TIDAK lewat cross-dept admin (scope itu untuk agregasi multi-proyek/redaksi rupiah, di sini
// cuma baca 1 proyek, read-only, tanpa nilai finansial).
import directus, { handleDirectusError } from './directus';
import { readItems } from '@directus/sdk';

export interface ForecastRow {
	id: string;
	project_id: number;
	subtask_id: string;
	subtask_name: string;
	category_name: string;
	ref_type: string;
	ref_id: string | null;
	ref_name: string;
	qty: number;
	unit: string | null;
	mob_stage: string | null;
	need_date: string | null;
	prepare_by_date: string | null;
	dept: string;
	status: string;
	linked_ref_type: string | null;
	linked_ref_id: string | null;
}

/** Semua baris forecast (belum diabaikan) untuk 1 proyek, diurut per tahap mobilisasi. */
export async function fetchForecastForProject(projectId: number): Promise<ForecastRow[]> {
	try {
		const rows = (await directus.request(
			readItems('project_resource_forecast', {
				filter: { project_id: { _eq: projectId }, status: { _neq: 'cancelled' } },
				sort: ['mob_stage', 'ref_name'],
				limit: -1
			})
		)) as ForecastRow[];
		return rows || [];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/** Nomor PL untuk baris forecast yang tertaut ke packing_list (1 query batch). id -> nomor_pl. */
export async function fetchPlNumbers(rows: ForecastRow[]): Promise<Record<string, string>> {
	const ids = [
		...new Set(
			rows
				.filter((r) => r.linked_ref_type === 'packing_list' && r.linked_ref_id && /^\d+$/.test(String(r.linked_ref_id)))
				.map((r) => Number(r.linked_ref_id))
		)
	];
	if (ids.length === 0) return {};
	try {
		const pls = (await directus.request(
			readItems('packing_list' as any, { filter: { id: { _in: ids } }, fields: ['id', 'nomor_pl'], limit: -1 })
		)) as Array<{ id: number; nomor_pl: string }>;
		return Object.fromEntries((pls || []).map((p) => [String(p.id), p.nomor_pl]));
	} catch (error) {
		handleDirectusError(error);
		return {};
	}
}
