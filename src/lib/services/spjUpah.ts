// src/lib/services/spjUpah.ts
// GPM-C09 — client service layar SPJ Upah. SELALU lewat /api/spj-upah, tidak pernah Directus langsung (pola sama services/siteCheckin.ts).

import { auth } from '$lib/firebase';
import { compressPhoto } from '$lib/utils/photoCompress';
import { fetchWithTimeout } from '$lib/utils/fetchWithTimeout';
import { HttpError } from '$lib/utils/networkError';

export type StatusBukti = 'belum' | 'menunggu' | 'disetujui' | 'ditolak';

export interface BarisBukti {
	id: number;
	jumlah_diterima: number;
	metode: string;
	diterima_at: string | null;
	bukti_file_id: string | null;
	status_verifikasi: string;
	catatan_verifikasi: string | null;
}

export interface PekerjaSpj {
	manpower_id: number;
	nama: string;
	jumlah_rincian: number;
	jumlah_diterima: number;
	status: StatusBukti;
	baris: BarisBukti[];
}

export interface PengajuanSpj {
	id: number;
	nomor_pengajuan: string;
	total_amount: number;
	tanggal_dicairkan: string;
	batas_tanggal: string;
	terlambat: boolean;
	lengkap: boolean;
	total_diterima: number;
	selisih: number;
	pekerja_belum_bukti: number;
	pekerja: PekerjaSpj[];
}

export interface DaftarSpj {
	koordinator: { id: number; nama: string };
	batas_hari: number;
	pengajuan: PengajuanSpj[];
}

async function getIdToken(): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return user.getIdToken();
}

async function pesanError(res: Response): Promise<string> {
	try {
		const data = await res.json();
		return data?.message || `Gagal (${res.status})`;
	} catch {
		return `Gagal (${res.status})`;
	}
}

export async function getDaftarSpj(): Promise<DaftarSpj> {
	const res = await fetchWithTimeout('/api/spj-upah', { headers: { Authorization: `Bearer ${await getIdToken()}` } }, 20_000);
	if (!res.ok) throw new HttpError(await pesanError(res), res.status);
	return res.json();
}

export interface InputBukti {
	paId: number;
	manpowerId: number;
	jumlah: number;
	metode: 'tunai' | 'transfer';
	foto: File;
	lat?: number | null;
	lng?: number | null;
}

/** Catat satu bukti pembagian. Foto dikompres dulu (HP 2G); server memvalidasi ulang semuanya. */
export async function kirimBukti(input: InputBukti): Promise<{ id: number | null }> {
	const form = new FormData();
	form.append('manpower_id', String(input.manpowerId));
	form.append('jumlah_diterima', String(input.jumlah));
	form.append('metode', input.metode);
	if (input.lat != null && input.lng != null) {
		form.append('lat', String(input.lat));
		form.append('lng', String(input.lng));
	}
	form.append('foto', await compressPhoto(input.foto));
	const res = await fetchWithTimeout(`/api/spj-upah/${input.paId}`, { method: 'POST', headers: { Authorization: `Bearer ${await getIdToken()}` }, body: form }, 60_000);
	if (!res.ok) throw new HttpError(await pesanError(res), res.status);
	return res.json();
}

export async function batalkanBukti(paId: number, barisId: number): Promise<void> {
	const res = await fetchWithTimeout(`/api/spj-upah/${paId}?baris=${barisId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${await getIdToken()}` } }, 20_000);
	if (!res.ok) throw new HttpError(await pesanError(res), res.status);
}
