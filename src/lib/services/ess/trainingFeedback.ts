// src/lib/services/ess/trainingFeedback.ts
// Client-side service utk survei "Training Feedback Loop" -- lewat /api/ess/training-feedback,
// TIDAK PERNAH akses Directus langsung (sama pola dgn services/ess/training.ts).

import { auth } from '$lib/firebase';

export interface TrainingFeedbackRecord {
	id: number;
	program_id: number;
	program_judul: string;
	status: 'pending' | 'diisi';
	tanggal_kirim: string | null;
	tanggal_isi: string | null;
	penerapan_skor: number | null;
	manfaat_skor: number | null;
	hambatan: string | null;
	catatan: string | null;
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

export async function getMyTrainingFeedback(): Promise<TrainingFeedbackRecord[]> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/training-feedback', { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	const body = await res.json();
	return body.data || [];
}

export interface SubmitTrainingFeedbackParams {
	id: number;
	penerapan_skor: number;
	manfaat_skor: number;
	hambatan?: string;
	catatan?: string;
}

export async function submitTrainingFeedback(params: SubmitTrainingFeedbackParams) {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/training-feedback', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(params)
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	const body = await res.json();
	return body.data;
}
