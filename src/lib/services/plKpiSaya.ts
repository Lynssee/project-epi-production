// src/lib/services/plKpiSaya.ts
// KPI Saya (versi ringan) untuk Project Leader: per proyek yang dipimpin -> Health Score (dihitung ERP,
// kolom projects.health_score) + angka operasional peralatan (WO/P2H/PM) dari getPlKpi.
// SPI/CPI SENGAJA tidak ada: EVM belum aktif (project.feature.evm_enabled=false, snapshot kosong) -> akan selalu N/A.
// Fail-soft per proyek: satu proyek gagal tidak menjatuhkan yang lain (galat dilog, bukan ditelan).

import directus, { handleDirectusError } from './directus';
import { readItems } from '@directus/sdk';
import { getLedProjects, getActiveEquipmentIds, getPlKpi, type PlKpi } from './plDashboard';

export type HealthTone = 'on_target' | 'warning' | 'critical' | 'no_data';

/** Ambang bawaan sama dengan Matriks KPI ERP (matrix_threshold_on_target=85, matrix_threshold_warning=65). */
export const HEALTH_THRESHOLD = { onTarget: 85, warning: 65 };

export function healthTone(score: number | null | undefined, thr = HEALTH_THRESHOLD): HealthTone {
	if (score == null || !Number.isFinite(Number(score))) return 'no_data';
	const s = Number(score);
	return s >= thr.onTarget ? 'on_target' : s >= thr.warning ? 'warning' : 'critical';
}

/** Persentase P2H hari ini (unit yang sudah P2H / total unit aktif); null bila tak ada unit. */
export function p2hPct(kpi: Pick<PlKpi, 'p2hDone' | 'p2hEquipmentCount'> | null | undefined): number | null {
	const total = kpi?.p2hEquipmentCount ?? 0;
	return total > 0 ? Math.round(((kpi?.p2hDone ?? 0) / total) * 100) : null;
}

/** Daftar hal yang perlu perhatian leader dari satu proyek (teks siap tampil). */
export function perhatianProyek(p: { healthScore: number | null; kpi: PlKpi | null }): string[] {
	const out: string[] = [];
	if (healthTone(p.healthScore) === 'critical') out.push(`Health Score kritis (${Math.round(p.healthScore as number)})`);
	if ((p.kpi?.pmOverdue ?? 0) > 0) out.push(`${p.kpi!.pmOverdue} jadwal PM terlambat`);
	const pct = p2hPct(p.kpi);
	if (pct != null && pct < 100) out.push(`P2H hari ini baru ${pct}%`);
	return out;
}

export interface ProyekKpiSaya {
	id: number;
	name: string;
	status: string | null;
	endDate: string | null;
	healthScore: number | null;
	healthUpdatedAt: string | null;
	kpi: PlKpi | null;
}

export async function getProyekKpiSaya(karyawanId: number | null, karyawanName: string | null): Promise<ProyekKpiSaya[]> {
	const led = await getLedProjects(karyawanId, karyawanName);
	if (!led.length) return [];
	let rows: any[] = [];
	try {
		rows = (await directus.request(
			readItems('projects', {
				filter: { id: { _in: led.map((p) => p.id) } },
				fields: ['id', 'name', 'status', 'end_date', 'health_score', 'health_updated_at'],
				sort: ['name'],
				limit: -1
			})
		)) as any[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
	return Promise.all(
		rows.map(async (r) => {
			let kpi: PlKpi | null = null;
			try {
				const eq = await getActiveEquipmentIds([r.id]);
				kpi = eq.length ? await getPlKpi(eq) : null;
			} catch (e: any) {
				console.error(`[plKpiSaya] gagal memuat KPI peralatan proyek ${r.id}:`, e?.message || e);
			}
			return {
				id: r.id,
				name: r.name,
				status: r.status ?? null,
				endDate: r.end_date ?? null,
				healthScore: r.health_score != null && Number.isFinite(Number(r.health_score)) ? Number(r.health_score) : null,
				healthUpdatedAt: r.health_updated_at ?? null,
				kpi
			};
		})
	);
}
