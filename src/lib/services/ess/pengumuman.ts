// src/lib/services/ess/pengumuman.ts
// Client-side service ESS Pengumuman — selalu lewat /api/ess/pengumuman/*.

import { auth } from '$lib/firebase';

export interface PengumumanItem {
	id: string;
	judul: string;
	isi: string;
	kategori: string;
	tanggal_mulai: string;
	tanggal_selesai: string | null;
	is_read: boolean;
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

export async function getPengumumanList(): Promise<{ pengumuman: PengumumanItem[]; unreadCount: number }> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/pengumuman', { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function markPengumumanRead(id: string): Promise<void> {
	const idToken = await getIdToken();
	const res = await fetch(`/api/ess/pengumuman/${id}/read`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
}
