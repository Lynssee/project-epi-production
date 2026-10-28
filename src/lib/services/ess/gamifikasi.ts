// src/lib/services/ess/gamifikasi.ts
// Client-side service Fase 11c — selalu lewat /api/ess/gamifikasi (baca-saja).

import { auth } from '$lib/firebase';

export interface GamifikasiSummary {
	musim: { id: string; kode: string; nama: string; status: string; tanggal_mulai: string; tanggal_selesai: string } | null;
	poinSaya: number;
	peringkatSaya: number | null;
	totalPeserta: number;
	top10: { karyawan_id: string; nama_karyawan: string; total_poin: number }[];
	badgeSaya: { id: string; badge_nama: string; badge_icon: string | null; tanggal_diraih: string }[];
}

async function getIdToken(): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return user.getIdToken();
}

export async function getMyGamifikasi(): Promise<GamifikasiSummary> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/gamifikasi', { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		throw new Error(data?.message || `Gagal (${res.status})`);
	}
	return res.json();
}
