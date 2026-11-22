// src/lib/services/ess/trainingOutcome.ts
// Klien outcome/review training — lewat /api/ess/training/*, TIDAK akses Directus langsung.
import { auth } from '$lib/firebase';

export interface OutcomeItem { id: number; tipe: string; deskripsi: string; indikator: string | null; wajib: boolean; status?: string | null }
export interface MyOutcomeView {
	visible: boolean;
	outcomes: OutcomeItem[];
	persen: number | null;
	review: null | { peran: string; kekuatan: string | null; rekomendasi: string | null; tindakLanjut: string; kekurangan?: string | null; gaps?: { kategori: string; severity: string; deskripsi: string }[] };
}
export interface ReviewableEnrollment {
	enrollmentId: number; programJudul: string; status: string; nilaiAkhir: number | null;
	review: null | { id: number; kekuatan: string | null; kekurangan: string | null; rekomendasi: string | null; tindakLanjut: string; status: string; gaps: { kategori_id: number | null; severity: string; deskripsi: string }[] };
}
export interface ReviewableResponse { member: { id: number; nama: string }; kategori: { id: number; nama: string }[]; enrollments: ReviewableEnrollment[] }
export interface ReviewPayload {
	memberId: number; enrollmentId: number; kekuatan?: string; kekurangan?: string; rekomendasi?: string; tindakLanjut?: string;
	status: 'draft' | 'final'; gaps?: { kategori_id: number | null; severity: string; deskripsi: string }[];
}

async function authedFetch(url: string, options: RequestInit = {}): Promise<Response> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	const idToken = await user.getIdToken();
	return fetch(url, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${idToken}`, ...(options.headers || {}) } });
}
async function errMsg(res: Response): Promise<string> {
	try { return (await res.json())?.message || `Gagal (${res.status})`; } catch { return `Gagal (${res.status})`; }
}

export async function getMyOutcome(programId: number): Promise<MyOutcomeView> {
	const res = await authedFetch(`/api/ess/training/${programId}/outcome`);
	if (!res.ok) throw new Error(await errMsg(res));
	return res.json();
}
export async function getReviewable(memberId: number): Promise<ReviewableResponse> {
	const res = await authedFetch(`/api/ess/training/tim/review?memberId=${memberId}`);
	if (!res.ok) throw new Error(await errMsg(res));
	return res.json();
}
export async function submitReview(p: ReviewPayload): Promise<{ ok: true; reviewId: number; status: string }> {
	const res = await authedFetch('/api/ess/training/tim/review', { method: 'POST', body: JSON.stringify(p) });
	if (!res.ok) throw new Error(await errMsg(res));
	return res.json();
}
