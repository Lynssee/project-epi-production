// src/lib/services/notifikasiApi.ts
// Client-side service Notifikasi Terpusat v2 (Fase 5, dashboard lapangan) — selalu lewat
// /api/ess/notifikasi/*. Pola sama services/ess/pengumuman.ts.

import { auth } from '$lib/firebase';

export interface NotifikasiItem {
	id: number;
	type: string;
	title: string;
	message: string;
	priority: 'low' | 'medium' | 'high' | null;
	module: string | null;
	action_required: boolean;
	action_url: string | null;
	attachment_file_id: string | null;
	read: boolean;
	read_at: string | null;
	created_at: string;
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

// Fase 3 polish (rollout notifikasi Project, 14 Agu 2026): cache respons terakhir per
// kombinasi filter di localStorage, supaya bell/badge & halaman notifikasi tetap menampilkan
// data terakhir yang diketahui saat offline (mis. sinyal lemah di lapangan), bukan kosong/error.
// Cache HANYA dipakai sebagai fallback saat fetch gagal — tidak pernah lebih diutamakan dari
// data live.
export interface NotifikasiListResult {
	notifikasi: NotifikasiItem[];
	total: number;
	unreadCount: number;
	fromCache?: boolean;
	cachedAt?: string;
}

const CACHE_KEY_PREFIX = 'epi_notifikasi_cache_';

function cacheKey(params: { read?: boolean; module?: string; page?: number }): string {
	return `${CACHE_KEY_PREFIX}${params.read ?? ''}_${params.module ?? ''}_${params.page ?? 1}`;
}

function readCache(key: string): NotifikasiListResult | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(key);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

function writeCache(key: string, result: { notifikasi: NotifikasiItem[]; total: number; unreadCount: number }) {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(key, JSON.stringify({ ...result, cachedAt: new Date().toISOString() }));
	} catch {
		// storage penuh/private mode — cache best-effort, bukan hal kritis
	}
}

export async function getNotifikasiList(
	params: { read?: boolean; module?: string; page?: number } = {}
): Promise<NotifikasiListResult> {
	const key = cacheKey(params);
	try {
		const idToken = await getIdToken();
		const qp = new URLSearchParams();
		if (params.read !== undefined) qp.set('read', String(params.read));
		if (params.module) qp.set('module', params.module);
		if (params.page) qp.set('page', String(params.page));

		const res = await fetch(`/api/ess/notifikasi?${qp.toString()}`, { headers: { Authorization: `Bearer ${idToken}` } });
		if (!res.ok) throw new Error(await parseErrorMessage(res));
		const result = await res.json();
		writeCache(key, result);
		return result;
	} catch (err) {
		const cached = readCache(key);
		if (cached) return { ...cached, fromCache: true };
		throw err;
	}
}

export async function markNotifikasiRead(id: number): Promise<void> {
	const idToken = await getIdToken();
	const res = await fetch(`/api/ess/notifikasi/${id}/read`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
}

export function downloadNotifikasiPdfUrl(id: number): string {
	return `/api/notifikasi/${id}/download`;
}

/** Ambil Blob PDF notifikasi terotentikasi untuk preview atau unduh. */
export async function getNotifikasiPdfBlob(id: number): Promise<Blob> {
	const idToken = await getIdToken();
	const res = await fetch(downloadNotifikasiPdfUrl(id), { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return await res.blob();
}

/** Unduh PDF dengan header Authorization (endpoint butuh Firebase token, bukan link langsung). */
export async function downloadNotifikasiPdf(id: number): Promise<void> {
	const blob = await getNotifikasiPdfBlob(id);
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `notifikasi-${id}.pdf`;
	a.click();
	URL.revokeObjectURL(url);
}
