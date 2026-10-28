// src/lib/services/ess/hrDocuments.ts
// Client-side service ESS Dokumen Saya — selalu lewat /api/ess/my-hr-documents/*.

import { auth } from '$lib/firebase';

export interface HrDocument {
	id: number;
	nomor_dokumen: string;
	jenis: string;
	judul: string | null;
	status: string;
	status_ttd: string | null;
	tanggal_terbit: string | null;
	tanggal_expired: string | null;
	file_id: string | null;
	needsSignature: boolean;
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

export async function getMyHrDocuments(): Promise<{ documents: HrDocument[]; pendingCount: number }> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/my-hr-documents', {
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function downloadMyHrDocument(id: number): Promise<Blob> {
	const idToken = await getIdToken();
	const res = await fetch(`/api/ess/my-hr-documents/${id}/download`, {
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.blob();
}

export async function signMyHrDocument(id: number, ttdDataUrl: string): Promise<{ success: boolean; statusTtd: string }> {
	const idToken = await getIdToken();
	const res = await fetch(`/api/ess/my-hr-documents/${id}/sign`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
		body: JSON.stringify({ ttdDataUrl })
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}
