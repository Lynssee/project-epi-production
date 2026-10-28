// src/lib/server/ess/kpiPeerReview.ts
// Fase 11b (KPI Terpadu — Peer/360 Review). kpi_review.penilai_tipe sudah punya pilihan
// 'rekan' sejak Fase 3 — yang baru di sini adalah membaca ASSIGNMENT (kpi_management.
// peer_reviewer_ids, diisi HRD/atasan di Admin) dan memberi karyawan tempat mengisinya.
//
// peer_reviewer_ids difilter di JS (bukan filter Directus) karena keanggotaan array JSON
// tidak punya operator filter yang andal lintas versi Directus — data KPI berskala puluhan
// record per periode, jadi aman diambil lalu difilter di server.

import { directusServerJson } from '$lib/server/directus';
import { SELF_ASSESSMENT_KRITERIA, type KriteriaItem, type KpiReview } from '$lib/server/ess/kpi';

export interface PeerAssignment {
	id: string;
	karyawan_id: string;
	nama_karyawan: string;
	periode: string;
	tahun: number | null;
	status: string;
}

/** KPI Karyawan (bukan milik sendiri) yang menunjuk karyawanId sbg rekan penilai. */
export async function listPeerAssignments(karyawanId: number): Promise<PeerAssignment[]> {
	const query = new URLSearchParams({
		'filter[peer_reviewer_ids][_nnull]': 'true',
		'filter[tipe][_eq]': 'Karyawan',
		fields: 'id,karyawan_id,nama_karyawan,periode,tahun,status,peer_reviewer_ids',
		limit: '-1'
	});
	const result = await directusServerJson<{ data: (PeerAssignment & { peer_reviewer_ids: unknown })[] }>(
		`/items/kpi_management?${query.toString()}`
	);
	return (result?.data || [])
		.filter((r) => {
			const ids = Array.isArray(r.peer_reviewer_ids) ? r.peer_reviewer_ids.map(Number) : [];
			return ids.includes(karyawanId) && String(r.karyawan_id) !== String(karyawanId);
		})
		.map(({ peer_reviewer_ids, ...rest }) => rest);
}

export async function isAssignedPeerReviewer(karyawanId: number, scorecardId: string): Promise<boolean> {
	const assignments = await listPeerAssignments(karyawanId);
	return assignments.some((a) => a.id === scorecardId);
}

export async function listMyPeerReviews(reviewerKaryawanId: number): Promise<KpiReview[]> {
	const query = new URLSearchParams({
		'filter[penilai_tipe][_eq]': 'rekan',
		'filter[penilai_karyawan_id][_eq]': String(reviewerKaryawanId),
		fields: ['id', 'scorecard_id', 'penilai_tipe', 'kriteria', 'total_nilai', 'komentar', 'status'].join(',')
	});
	const result = await directusServerJson<{ data: KpiReview[] }>(`/items/kpi_review?${query.toString()}`);
	return result?.data || [];
}

function calcTotalNilai(kriteria: KriteriaItem[]): number {
	const totalWeight = kriteria.reduce((s, k) => s + (Number(k.weight) || 0), 0);
	if (totalWeight === 0) return 0;
	const weighted = kriteria.reduce((sum, k) => sum + (Number(k.score) || 0) * (Number(k.weight) || 0), 0);
	return Math.round((weighted / totalWeight) * 10) / 10;
}

export async function submitPeerReview(
	scorecardId: string,
	reviewerKaryawanId: number,
	kriteria: KriteriaItem[],
	komentar: string
): Promise<KpiReview> {
	const myReviews = await listMyPeerReviews(reviewerKaryawanId);
	const existing = myReviews.find((r) => r.scorecard_id === scorecardId);
	const totalNilai = calcTotalNilai(kriteria);
	const payload = {
		scorecard_id: scorecardId,
		penilai_tipe: 'rekan',
		penilai_karyawan_id: String(reviewerKaryawanId),
		kriteria,
		total_nilai: totalNilai,
		komentar,
		status: 'Submitted'
	};

	if (existing) {
		const result = await directusServerJson<{ data: KpiReview }>(`/items/kpi_review/${existing.id}`, {
			method: 'PATCH',
			body: JSON.stringify(payload)
		});
		return result.data;
	}

	const result = await directusServerJson<{ data: KpiReview }>('/items/kpi_review', {
		method: 'POST',
		body: JSON.stringify(payload)
	});
	return result.data;
}

export { SELF_ASSESSMENT_KRITERIA as PEER_REVIEW_KRITERIA };
