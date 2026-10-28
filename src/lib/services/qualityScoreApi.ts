// src/lib/services/qualityScoreApi.ts
// Quality Management Proyek v2, Fase 1 — pembaca read-only snapshot proj_quality_score
// untuk Quality Cockpit lapangan (R6). Skor dihitung HARIAN oleh n8n di admin
// (snapshotQualityScore di qualityApi.js) — lapangan hanya baca snapshot, tidak hitung ulang
// (prinsip "Snapshot bukan real-time" — Arsitektur Hemat Usage, dokumen Fase 0 §3).

import directus, { handleDirectusError } from './directus';
import { readItems } from '@directus/sdk';

export interface QualityScoreSnapshot {
	id: number;
	project_id: number;
	period_date: string;
	pass_rate: number | null;
	capa_penalty: number;
	quality_score: number | null;
	inspection_count: number;
	capa_open_count: number;
}

/** Snapshot terbaru untuk sebuah proyek, atau null bila belum pernah di-snapshot. */
export async function fetchLatestQualityScore(projectId: number): Promise<QualityScoreSnapshot | null> {
	try {
		const rows = await directus.request(
			readItems('proj_quality_score' as any, {
				filter: { project_id: { _eq: projectId } } as any,
				sort: ['-period_date'],
				limit: 1
			})
		);
		return (rows as any[])[0] || null;
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

/** Tren skor N hari terakhir (default 14) untuk sparkline Quality Cockpit. */
export async function fetchQualityScoreTrend(projectId: number, days = 14): Promise<QualityScoreSnapshot[]> {
	try {
		const rows = await directus.request(
			readItems('proj_quality_score' as any, {
				filter: { project_id: { _eq: projectId } } as any,
				sort: ['-period_date'],
				limit: days
			})
		);
		return ((rows as any[]) || []).slice().reverse();
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}
