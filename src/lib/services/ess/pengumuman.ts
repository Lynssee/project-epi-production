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

type PengumumanListResult = { pengumuman: PengumumanItem[]; unreadCount: number };

const CACHE_TTL_MS = 30_000;
let listCache: { uid: string; at: number; data: PengumumanListResult } | null = null;
let listInflight: { uid: string; promise: Promise<PengumumanListResult> } | null = null;

export function clearPengumumanClientCache() {
	listCache = null;
	listInflight = null;
}

export async function getPengumumanList(opts?: { force?: boolean }): Promise<PengumumanListResult> {
	const uid = auth.currentUser?.uid || '';
	const now = Date.now();
	if (!opts?.force && uid && listCache && listCache.uid === uid && now - listCache.at < CACHE_TTL_MS) {
		return listCache.data;
	}
	if (!opts?.force && uid && listInflight && listInflight.uid === uid) {
		return listInflight.promise;
	}

	const pending = (async (): Promise<PengumumanListResult> => {
		const idToken = await getIdToken();
		const res = await fetch('/api/ess/pengumuman', { headers: { Authorization: `Bearer ${idToken}` } });
		if (!res.ok) throw new Error(await parseErrorMessage(res));
		const data: PengumumanListResult = await res.json();
		if (uid) listCache = { uid, at: Date.now(), data };
		return data;
	})().finally(() => {
		if (listInflight?.promise === pending) listInflight = null;
	});

	if (uid) listInflight = { uid, promise: pending };
	return pending;
}

export async function markPengumumanRead(id: string): Promise<void> {
	const idToken = await getIdToken();
	const res = await fetch(`/api/ess/pengumuman/${id}/read`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	clearPengumumanClientCache();
}
