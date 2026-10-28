// src/lib/services/ess/silabus.ts
// Client-side service ESS Silabus Jabatan — SELALU lewat /api/ess/training/silabus, TIDAK PERNAH
// akses Directus langsung (sama prinsipnya dengan services/ess/training.ts).

import { auth } from '$lib/firebase';

export interface SilabusMateriProgress {
	id: number;
	urutan: number | null;
	isWajib: boolean;
	programId: number;
	programJudul: string;
	programKategori: string | null;
	status: 'Lulus' | 'Ongoing' | 'Enrolled' | 'Remedial' | 'Gagal' | 'Belum Terdaftar';
	progressPersen: number;
	tenggat: string | null;
	locked: boolean;
	prerequisiteProgramJudul: string | null;
}

export interface SilabusProgress {
	id: number;
	namaSilabus: string;
	deskripsi: string | null;
	kategori: string | null;
	isWajib: boolean;
	target: { targetHari: number | null; passingGrade: number | null } | null;
	materi: SilabusMateriProgress[];
	totalWajib: number;
	wajibSelesai: number;
	progressPersen: number;
	selesai: boolean;
}

export interface SilabusSayaResponse {
	position: { id: number; nama_posisi: string } | null;
	silabusList: SilabusProgress[];
}

export interface TeamMemberSilabusProgress {
	karyawanId: number;
	namaKaryawan: string;
	position: { id: number; nama_posisi: string } | null;
	silabusList: SilabusProgress[];
	totalWajibKeseluruhan: number;
	selesaiKeseluruhan: number;
}

async function parseErrorMessage(res: Response): Promise<string> {
	try {
		const data = await res.json();
		return data?.message || `Gagal (${res.status})`;
	} catch {
		return `Gagal (${res.status})`;
	}
}

async function getIdToken(): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return user.getIdToken();
}

async function authedFetch(url: string, options: RequestInit = {}): Promise<Response> {
	const idToken = await getIdToken();
	return fetch(url, {
		...options,
		headers: {
			...(options.body ? { 'Content-Type': 'application/json' } : {}),
			Authorization: `Bearer ${idToken}`,
			...(options.headers || {})
		}
	});
}

export async function getSilabusSaya(): Promise<SilabusSayaResponse> {
	const res = await authedFetch('/api/ess/training/silabus');
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function getTimSilabus(): Promise<{ anggota: TeamMemberSilabusProgress[] }> {
	const res = await authedFetch('/api/ess/training/tim');
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}
