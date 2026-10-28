// src/lib/services/ess/offboarding.ts
// Client-side service ESS Offboarding & Resign — SELALU lewat /api/ess/offboarding/*, TIDAK
// PERNAH akses Directus langsung.

import { auth } from '$lib/firebase';

export interface OffboardingCaseRecord {
	id: number;
	karyawan_id: number;
	jenis: string;
	tanggal_pengajuan: string | null;
	tanggal_efektif: string | null;
	alasan: string | null;
	status: string;
	progress: number;
	settlement_blocked: boolean;
	settlement_block_reason: string | null;
	trigger_type: string | null;
}

export interface OffboardingClearanceRecord {
	id: number;
	kategori: string | null;
	nama_task: string;
	pic_department: string | null;
	status: 'pending' | 'cleared' | 'na';
	cleared_by: string | null;
	cleared_at: string | null;
}

export interface OffboardingStatus {
	kasus: OffboardingCaseRecord | null;
	clearance: OffboardingClearanceRecord[];
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

export async function getMyOffboardingStatus(): Promise<OffboardingStatus> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/offboarding', { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function submitResign(alasan: string, tanggalEfektif: string): Promise<{ skipped?: string; offboardingCaseId?: number }> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/offboarding/resign', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
		body: JSON.stringify({ alasan, tanggalEfektif })
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}
