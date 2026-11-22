// src/lib/services/ess/sop.ts
// Client-side service ESS SOP — SELALU lewat /api/ess/sop/*, TIDAK PERNAH akses
// Directus langsung (sama prinsipnya dengan services/ess/training.ts).

import { auth } from '$lib/firebase';

export interface SopDocument {
	id: number;
	title: string;
	department: string | null;
	version: string;
	version_seq: number;
	last_updated: string | null;
	status: string;
	keterangan: string | null;
	content: string | null;
	content_source: 'file' | 'richtext' | 'hybrid';
	requires_training: boolean;
	target_departments: string[];
	target_roles: string[];
	effective_date: string | null;
	retraining_policy: string;
	sop_code?: string | null;
	file: Array<{ id: number; directus_files_id: { id: string; filename_download: string } }>;
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

async function authedFetch(url: string, options: RequestInit = {}): Promise<Response> {
	const idToken = await getIdToken();
	return fetch(url, {
		...options,
		headers: {
			...(options.body ? { 'Content-Type': 'application/json' } : {}),
			Authorization: `Bearer ${idToken}`,
			...(options.headers || {})
		}
	});
}

export async function getSopList(): Promise<{ sopList: SopDocument[]; compliance: { confirmed: number; total: number } }> {
	const res = await authedFetch('/api/ess/sop');
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export interface SopTrainingStatus {
	programId: number;
	judul: string;
	status: string;
	progress: number;
	tenggat: string | null;
}

export async function getSopDetail(id: number | string): Promise<{ sop: SopDocument; sudahKonfirmasi: boolean; training?: SopTrainingStatus | null }> {
	const res = await authedFetch(`/api/ess/sop/${id}`);
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function confirmSopRead(id: number | string): Promise<{ ok: true }> {
	const res = await authedFetch(`/api/ess/sop/${id}/confirm`, { method: 'POST' });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function submitSopUsulan(id: number | string, input: { jenis: string; catatan: string }): Promise<{ success: true; id: number | null }> {
	const res = await authedFetch(`/api/ess/sop/${id}/usulan`, { method: 'POST', body: JSON.stringify(input) });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export interface SopSertifikat {
	sopId: number;
	sop_code: string | null;
	title: string;
	programId: number;
	sertifikat_no: string | null;
	sertifikat_expired: string | null;
}

/** Badge "Tersertifikasi SOP" — best-effort: gagal/offline → daftar kosong (tidak mengganggu halaman utama). */
export async function getSopSertifikasi(): Promise<SopSertifikat[]> {
	try {
		const res = await authedFetch('/api/ess/sop/sertifikasi');
		if (!res.ok) return [];
		return (await res.json())?.sertifikasi || [];
	} catch {
		return [];
	}
}

export interface SopSkor { sopId: number; score: number | null; status: string; read: string; has_quiz: boolean; program_id: number | null; passing: number }

/** Skor Pengetahuan SOP Saya per dokumen — best-effort: gagal/offline → kosong (tidak mengganggu daftar). */
export async function getSopSkor(): Promise<SopSkor[]> {
	try {
		const res = await authedFetch('/api/ess/sop/skor');
		if (!res.ok) return [];
		return (await res.json())?.skor || [];
	} catch {
		return [];
	}
}
