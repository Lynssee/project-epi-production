// src/lib/services/ess/kpiPeerReview.ts
// Client-side service Fase 11b — selalu lewat /api/ess/kpi-peer-review.

import { auth } from '$lib/firebase';
import type { KriteriaItem, KpiReview } from '$lib/services/ess/kpi';

export interface PeerAssignment {
	id: string;
	karyawan_id: string;
	nama_karyawan: string;
	periode: string;
	tahun: number | null;
	status: string;
}

async function getIdToken(): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return user.getIdToken();
}

async function parseErrorMessage(res: Response): Promise<string> {
	try {
		const data = await res.json();
		return data?.message || `Gagal (${res.status})`;
	} catch {
		return `Gagal (${res.status})`;
	}
}

export async function getPeerReviewList(): Promise<{
	assignments: PeerAssignment[];
	myReviews: KpiReview[];
	defaultKriteria: KriteriaItem[];
}> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/kpi-peer-review', { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function submitPeerReview(
	scorecardId: string,
	kriteria: KriteriaItem[],
	komentar: string
): Promise<{ review: KpiReview }> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/kpi-peer-review', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ scorecardId, kriteria, komentar })
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}
