// src/lib/utils/dataDasarProyek.ts
// Evaluator "data dasar proyek" untuk gate G_SIAP_PA (Pengajuan Anggaran) & G_PKL_READINESS (Packing List).
// KEMBAR dari erp-epi/src/lib/data/projectDataDasar.js — logika WAJIB identik (dijaga test kontrak di dataDasarProyek.test.ts).
// Field NYATA Directus `projects`: jenis_project, end_date, lokasi, timeline_planning.metadata.thumbnail_file_id.

function asObject(v: any): any {
	if (!v) return null;
	if (typeof v === 'object') return v;
	try {
		const o = JSON.parse(v);
		return o && typeof o === 'object' ? o : null;
	} catch {
		return null;
	}
}

export const DATA_DASAR_EVALUATORS: Record<string, (p: any) => boolean> = {
	jenis_project_set: (p) => !!String(p?.jenis_project ?? '').trim(),
	deadline_set: (p) => !!p?.end_date,
	lokasi_set: (p) => !!String(p?.lokasi ?? '').trim(),
	foto_proyek_set: (p) => !!asObject(p?.timeline_planning)?.metadata?.thumbnail_file_id
};

export const DATA_DASAR_LABELS: Record<string, string> = {
	jenis_project_set: 'Jenis pekerjaan',
	deadline_set: 'Deadline',
	lokasi_set: 'Lokasi proyek',
	foto_proyek_set: 'Foto proyek'
};

/** Default `project.readiness.gate_extra_items` — dipakai bila setelan tidak ada di system_settings. */
export const DEFAULT_GATE_EXTRA_ITEMS = ['jenis_project_set', 'deadline_set', 'lokasi_set', 'foto_proyek_set'];

/** Id item data dasar yang belum terpenuhi. Id di luar peta diabaikan. */
export function missingDataDasar(project: any, ids: unknown): string[] {
	return (Array.isArray(ids) ? ids : []).filter((id: string) => DATA_DASAR_EVALUATORS[id] && !DATA_DASAR_EVALUATORS[id](project));
}
