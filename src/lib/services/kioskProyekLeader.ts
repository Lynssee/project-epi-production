// src/lib/services/kioskProyekLeader.ts
// Klien tipis untuk /api/manpower-leader/kiosk (Rencana Kiosk Proyek, Fase 1).
// Semua keputusan ada di server; di sini hanya Bearer token + parsing pesan error.

import { auth } from '$lib/firebase';

export interface KioskPerangkat {
	id: number;
	label: string | null;
	jenis: string | null;
	manpower_nama?: string | null;
	diaktifkan_oleh: string | null;
	kedaluwarsa_pada: string | null;
	terakhir_dipakai: string | null;
	status: 'aktif' | 'dicabut' | 'kedaluwarsa';
}
export interface KioskInfo {
	kode: string;
	aktif: boolean;
	qr_detik: number;
	masa_berlaku_hari: number;
	kode_harian: string | null;
	kode_harian_mode: 'harian' | 'nonaktif';
	perangkat: KioskPerangkat[];
}

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
	const idToken = await auth.currentUser?.getIdToken();
	const res = await fetch(url, {
		...init,
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json', ...(init.headers || {}) }
	});
	if (!res.ok) {
		let msg = `Gagal (${res.status})`;
		try {
			msg = (await res.json())?.message || msg;
		} catch {
			/* bukan JSON */
		}
		throw new Error(msg);
	}
	return res.json();
}

export const getKioskInfo = (projectId: number) =>
	call<KioskInfo>(`/api/manpower-leader/kiosk?project_id=${projectId}`);

export const getAktivasiToken = (projectId: number) =>
	call<{ kode: string; token: string; exp: number }>('/api/manpower-leader/kiosk', {
		method: 'POST',
		body: JSON.stringify({ project_id: projectId, action: 'token' })
	});

export const cabutPerangkat = (projectId: number, id: number) =>
	call<{ ok: true }>('/api/manpower-leader/kiosk', {
		method: 'POST',
		body: JSON.stringify({ project_id: projectId, action: 'cabut', id })
	});

/** URL kiosk. Token ditaruh di FRAGMEN (#t=) supaya tidak masuk log server/proxy/Referer. */
export function kioskUrl(origin: string, kode: string, token?: string): string {
	return `${origin}/k/${kode}${token ? `#t=${token}` : ''}`;
}

/** Setujui massal absensi "normal" — server menilai ulang tiap baris; anomali dikembalikan di `dilewati`. */
export const verifikasiMassal = (projectId: number, ids: number[]) =>
	call<{ ok: true; disetujui: number; dilewati: Array<{ id: number; alasan: string }> }>('/api/manpower-leader/verifikasi-massal', {
		method: 'POST',
		body: JSON.stringify({ project_id: projectId, ids })
	});
