// src/lib/data/processProjectStageDefaults.ts
// Bawaan tahap proyek untuk "Panduan SOP Tahap Ini" — CERMIN erp-epi/src/lib/utils/processProjectStages.js (DEFAULT_PROJECT_STAGES).
// Dipakai bila setelan app_settings `process_guidance`/`project_stages` belum dibuat/tidak terbaca. JAGA SEJALAN dengan versi admin.
export interface ProjectStage {
	key: string;
	label: string;
	urutan: number;
	aktif: boolean;
	match: { project_status: string[]; wajib_key: string[] };
}

export const DEFAULT_PROJECT_STAGES: ProjectStage[] = [
	{ key: 'persiapan', label: 'Persiapan', urutan: 1, aktif: true, match: { project_status: ['waiting'], wajib_key: [] } },
	{ key: 'mobilisasi', label: 'Mobilisasi', urutan: 2, aktif: true, match: { project_status: [], wajib_key: ['mobilisasi'] } },
	{ key: 'eksekusi', label: 'Eksekusi Pekerjaan', urutan: 3, aktif: true, match: { project_status: ['on progress'], wajib_key: [] } },
	{ key: 'qa_qc', label: 'QA / QC & Inspeksi', urutan: 4, aktif: true, match: { project_status: [], wajib_key: [] } },
	{ key: 'demobilisasi', label: 'Demobilisasi', urutan: 5, aktif: true, match: { project_status: [], wajib_key: ['demobilisasi'] } },
	{ key: 'closing', label: 'Closing & BAST', urutan: 6, aktif: true, match: { project_status: ['selesai'], wajib_key: ['bast'] } }
];
