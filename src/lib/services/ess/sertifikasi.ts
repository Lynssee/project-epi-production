// src/lib/services/ess/sertifikasi.ts
// Client-side service ESS Sertifikasi — SELALU lewat /api/ess/sertifikasi, TIDAK PERNAH akses
// Directus langsung.

import { auth } from '$lib/firebase';

export interface SertifikasiItem {
	id: number;
	karyawan_id: number;
	nama_sertifikasi: string;
	penerbit: string | null;
	tanggal_terbit: string | null;
	tanggal_expired: string | null;
	file_id: string | null;
	catatan: string | null;
	hariLagi: number | null;
	urgensi: 'aman' | 'perhatian' | 'segera' | 'kedaluwarsa';
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

export async function getMySertifikasi(): Promise<SertifikasiItem[]> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/sertifikasi', { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	const body = await res.json();
	return body.sertifikasi;
}

export async function saveSertifikasi(payload: {
	id?: number;
	nama_sertifikasi: string;
	penerbit?: string;
	tanggal_terbit?: string;
	tanggal_expired?: string;
	catatan?: string;
	file?: File | null;
}): Promise<void> {
	const idToken = await getIdToken();
	const formData = new FormData();
	if (payload.id) formData.append('id', String(payload.id));
	formData.append('nama_sertifikasi', payload.nama_sertifikasi);
	if (payload.penerbit) formData.append('penerbit', payload.penerbit);
	if (payload.tanggal_terbit) formData.append('tanggal_terbit', payload.tanggal_terbit);
	if (payload.tanggal_expired) formData.append('tanggal_expired', payload.tanggal_expired);
	if (payload.catatan) formData.append('catatan', payload.catatan);
	if (payload.file) formData.append('file', payload.file);

	const res = await fetch('/api/ess/sertifikasi', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` },
		body: formData
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
}
