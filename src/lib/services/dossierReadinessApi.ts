// src/lib/services/dossierReadinessApi.ts
// Visibilitas Leader Fase 3 — klien data mentah kesiapan dokumentasi lapangan (tanpa nominal rupiah).
import { getIdToken } from './secureDirectus';
import type { ReadinessThresholds } from '$lib/utils/dossierReadiness';

export type DossierReadinessRaw =
	| { applicable: false; reason?: string; generated_at: string }
	| {
			applicable: true;
			days: string[];
			absensiDates: string[] | null;
			absensiMenunggu: number;
			reportDates: string[] | null;
			qcRequiredDays: string[] | null;
			qcDoneDays: string[] | null;
			lpj: { belum: number; overdue: number; firstId: number | null } | null;
			absensiFailed?: boolean;
			reportsFailed?: boolean;
			thresholds: ReadinessThresholds;
			warnings: string[];
			generated_at: string;
	  };

export async function loadDossierReadiness(projectId: number | string): Promise<DossierReadinessRaw> {
	const token = await getIdToken();
	const res = await fetch(`/api/proyek/${encodeURIComponent(String(projectId))}/dossier-readiness`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (!res.ok) {
		const err = new Error(`HTTP ${res.status}`) as Error & { status?: number };
		err.status = res.status;
		throw err;
	}
	const body = await res.json();
	if (!body?.success) throw new Error(body?.error || 'Gagal memuat kesiapan dokumentasi');
	return body.data as DossierReadinessRaw;
}
