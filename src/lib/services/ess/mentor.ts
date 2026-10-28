// src/lib/services/ess/mentor.ts
// Client-side service ESS Mentor Dashboard (Fase 4.3) — SELALU lewat /api/ess/mentor/*.

import { auth } from '$lib/firebase';

export interface MenteeSummary {
	onboardingId: number;
	karyawanId: number;
	namaKaryawan: string;
	jenis: string;
	status: string;
	progress: number;
	skorAkhir: number | null;
	rekomendasi: string | null;
	totalTasks: number;
	doneTasks: number;
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

export async function getMentees(): Promise<{ mentees: MenteeSummary[] }> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/mentor', { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function submitMenteeEvaluation(onboardingId: number, skorAkhir: number, rekomendasi: string, catatan: string): Promise<void> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/mentor/evaluasi', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ onboardingId, skorAkhir, rekomendasi, catatan })
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
}
