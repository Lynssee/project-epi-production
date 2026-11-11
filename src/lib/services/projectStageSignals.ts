// src/lib/services/projectStageSignals.ts
// Sinyal tahap aktif proyek untuk "Panduan SOP Tahap Ini": status + timeline_planning (JSON subtask ber-wajib_key) dari `projects`.
// SATU query untuk semua proyek leader; fail-soft ([]). Hanya dipanggil bila ada alur ber-tahap (lihat LeaderSopTahapCard).
import { secureDirectusJson } from './secureDirectus';

export interface ProjectStageSignal {
	id: number;
	name: string;
	status: string | null;
	timeline_planning: unknown;
}

export async function getProjectStageSignals(projectIds: number[]): Promise<ProjectStageSignal[]> {
	const ids = [...new Set(projectIds.filter((n) => Number.isInteger(n) && n > 0))];
	if (!ids.length) return [];
	try {
		const res = await secureDirectusJson<{ data: any[] }>(`/items/projects?filter[id][_in]=${ids.join(',')}&fields=id,name,status,timeline_planning&limit=-1`);
		return (res?.data || []).map((p) => ({ id: Number(p.id), name: String(p.name ?? `Proyek #${p.id}`), status: p.status ?? null, timeline_planning: p.timeline_planning ?? null }));
	} catch (e) {
		console.warn('[projectStageSignals] gagal memuat sinyal tahap:', e instanceof Error ? e.message : e);
		return [];
	}
}
