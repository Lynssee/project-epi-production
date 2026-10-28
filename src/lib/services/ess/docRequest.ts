// src/lib/services/ess/docRequest.ts
// Client-side service ESS Permintaan Dokumen — selalu lewat /api/ess/doc-request.

import { auth } from '$lib/firebase';

export interface DocRequest {
	id: number;
	jenis_dokumen: string;
	keperluan: string;
	prioritas: 'biasa' | 'mendesak';
	status: 'menunggu' | 'diproses' | 'selesai' | 'ditolak';
	generated_document: number | null;
	rejection_reason: string | null;
	date_created: string;
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

export async function getMyDocRequests(): Promise<{ requests: DocRequest[] }> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/doc-request', { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function submitDocRequest(payload: { jenis_dokumen: string; keperluan: string; prioritas?: 'biasa' | 'mendesak' }) {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/doc-request', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
		body: JSON.stringify(payload)
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}
