// src/lib/services/ess/onboarding.ts
// Client-side service ESS Onboarding — SELALU lewat /api/ess/onboarding, TIDAK PERNAH akses
// Directus langsung.

import { auth } from '$lib/firebase';

export interface OnboardingTaskRecord {
	id: number;
	kategori: string | null;
	nama_task: string;
	pic_department: string | null;
	completed: boolean;
	completed_at: string | null;
	due_date: string | null;
	sort: number | null;
	lampiran: string | null;
	submitted_by_karyawan: boolean;
	submitted_at: string | null;
	catatan: string | null;
}

export interface OnboardingCaseRecord {
	id: number;
	karyawan_id: number;
	jenis: string;
	tanggal_pengajuan: string | null;
	tanggal_efektif: string | null;
	status: string;
	progress: number;
	mentor_id: number | null;
	mentor_nama: string | null;
	skor_mentor: number | null;
	catatan_mentor: string | null;
	mentor_dinilai_pada: string | null;
}

export interface OnboardingStatus {
	kasus: OnboardingCaseRecord | null;
	tasks: OnboardingTaskRecord[];
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

export async function getMyOnboardingStatus(): Promise<OnboardingStatus> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/onboarding', { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function submitTaskEvidence(onboardingId: number, taskId: number, file: File | null, catatan: string): Promise<void> {
	const idToken = await getIdToken();
	const formData = new FormData();
	formData.append('onboardingId', String(onboardingId));
	formData.append('taskId', String(taskId));
	if (catatan) formData.append('catatan', catatan);
	if (file) formData.append('file', file);

	const res = await fetch('/api/ess/onboarding', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` },
		body: formData
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
}

export async function rateMentor(onboardingId: number, skorMentor: number, catatanMentor: string): Promise<{ kasus: OnboardingCaseRecord }> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/onboarding', {
		method: 'PATCH',
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ onboardingId, skorMentor, catatanMentor })
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}
