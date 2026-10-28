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

export async function getSopDetail(id: number | string): Promise<{ sop: SopDocument; sudahKonfirmasi: boolean }> {
	const res = await authedFetch(`/api/ess/sop/${id}`);
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function confirmSopRead(id: number | string): Promise<{ ok: true }> {
	const res = await authedFetch(`/api/ess/sop/${id}/confirm`, { method: 'POST' });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}
