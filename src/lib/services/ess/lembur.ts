// src/lib/services/ess/lembur.ts
// Client-side service ESS Lembur — selalu lewat /api/ess/lembur/*.

import { compressPhoto } from '$lib/utils/photoCompress';
import { auth } from '$lib/firebase';

export interface LemburRecord {
	id: string;
	karyawan_id: string;
	tanggal: string;
	jam_mulai: string | null;
	jam_selesai: string | null;
	alasan: string | null;
	status: string;
	approver_id: string | null;
	approved_at: string | null;
	catatan_approval: string | null;
	karyawan?: {
		id: number;
		nama_karyawan: string;
		divisi: string | null;
		posisi: string | null;
		foto?: string | null;
	} | null;
}

async function getIdToken(): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return user.getIdToken();
}

async function parseErrorMessage(res: Response): Promise<string> {
	if (res.status === 413) {
		return 'Ukuran foto atau data pengajuan terlalu besar (melebihi batas server). Silakan ambil ulang foto bukti dengan resolusi standar atau kirim tanpa foto.';
	}
	try {
		const data = await res.json();
		const msg = data?.message || '';
		if (/payload too large|body_size_limit|exceeded limit/i.test(msg)) {
			return 'Ukuran foto terlalu besar. Silakan coba kompres foto atau ambil ulang dengan resolusi standar.';
		}
		return msg || `Gagal (${res.status})`;
	} catch {
		return `Gagal (${res.status})`;
	}
}

export async function getLemburStatus(): Promise<{ riwayat: LemburRecord[] }> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/lembur/status', { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export interface AjukanLemburParams {
	tanggal: string;
	jam_mulai: string;
	jam_selesai: string;
	alasan: string;
	buktiFile: File | null;
	latitude?: string | number | null;
	longitude?: string | number | null;
	proyek_id?: string | null;
}

export async function ajukanLembur(params: AjukanLemburParams): Promise<{ record: LemburRecord; overtimeCalc?: any }> {
	const idToken = await getIdToken();
	const formData = new FormData();
	formData.append('tanggal', params.tanggal);
	formData.append('jam_mulai', params.jam_mulai);
	formData.append('jam_selesai', params.jam_selesai);
	formData.append('alasan', params.alasan);
	if (params.latitude != null) formData.append('latitude', String(params.latitude));
	if (params.longitude != null) formData.append('longitude', String(params.longitude));
	if (params.proyek_id != null) formData.append('proyek_id', params.proyek_id);

	if (params.buktiFile) {
		const compressed = await compressPhoto(params.buktiFile);
		formData.append('bukti', compressed, compressed.name || 'bukti.jpg');
	}

	const res = await fetch('/api/ess/lembur', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` },
		body: formData
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}


export async function getLemburApprovalInbox(): Promise<{ inbox: LemburRecord[]; history?: LemburRecord[] }> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/lembur/approval', { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function approveLembur(id: string): Promise<{ record: LemburRecord }> {
	const idToken = await getIdToken();
	const res = await fetch(`/api/ess/lembur/${id}/approve`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function rejectLembur(id: string, alasan: string): Promise<{ record: LemburRecord }> {
	const idToken = await getIdToken();
	const res = await fetch(`/api/ess/lembur/${id}/reject`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
		body: JSON.stringify({ alasan })
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}
