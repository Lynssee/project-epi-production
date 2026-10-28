// src/lib/services/clientCompliance.ts
// Pertajam Fase Planning — Fase 2 (sisi lapangan, READ-ONLY). Baca cache hasil evaluasi
// Kepatuhan Klien (WPO) yang ditulis admin erp-epi (client_compliance_evaluation).
// PL TIDAK upload/assign profil dari sini — itu tetap lewat ERP. Lihat
// clientComplianceEvaluator.js di erp-epi-1 untuk logika evaluasinya.

import directus, { handleDirectusError } from './directus';
import { readItems } from '@directus/sdk';

export interface ClientComplianceSummary {
	profile_id: number;
	score: number;
	total: number;
	passed: number;
	failed: number;
	warning: number;
	items_snapshot: Array<{ id: number; kategori: string; label: string; is_required: boolean; status: string; message: string | null }>;
	evaluated_at: string;
}

/** Cache terakhir (ditulis ERP saat admin buka tab Kepatuhan Klien). Null = belum pernah dievaluasi. */
export async function getClientComplianceSummary(projectId: number | string): Promise<ClientComplianceSummary | null> {
	try {
		const rows = (await directus.request(
			readItems('client_compliance_evaluation', {
				filter: { project_id: { _eq: projectId as any } },
				fields: ['profile_id', 'score', 'total', 'passed', 'failed', 'warning', 'items_snapshot', 'evaluated_at'],
				sort: ['-evaluated_at'],
				limit: 1
			})
		)) as unknown as ClientComplianceSummary[];
		return rows[0] || null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}
