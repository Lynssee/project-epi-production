// src/lib/services/csr.ts
// Bacaan & submit sisi klien untuk CSR / TJSL field app. Semua PENULISAN wajib lewat
// /api/csr/*/submit (token server) — masking NIK & validasi consent dihitung di server
// supaya tidak bisa dilewati dari klien. Lihat src/lib/server/ess/attendanceGuard.ts (reuse).

import { auth } from '$lib/firebase';

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

export interface CsrProgram {
	id: number;
	nama: string;
	pilar: string;
	lokasi: string | null;
	sasaran: string | null;
}

export async function fetchActivePrograms(): Promise<CsrProgram[]> {
	const idToken = await getIdToken();
	const res = await fetch('/api/csr/programs', { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	const data = await res.json();
	return data.programs || [];
}

export interface SubmitKegiatanParams {
	program_id: number;
	jenis: string;
	jumlah_penerima: number;
	catatan_lapangan: string;
	lat: number | null;
	lng: number | null;
	photos: File[];
}

export async function submitKegiatan(params: SubmitKegiatanParams) {
	const idToken = await getIdToken();
	const form = new FormData();
	form.append('program_id', String(params.program_id));
	form.append('jenis', params.jenis);
	form.append('jumlah_penerima', String(params.jumlah_penerima));
	form.append('catatan_lapangan', params.catatan_lapangan);
	if (params.lat !== null) form.append('lat', String(params.lat));
	if (params.lng !== null) form.append('lng', String(params.lng));
	params.photos.forEach((file, i) => form.append(`photo_${i}`, file));

	const res = await fetch('/api/csr/kegiatan/submit', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` },
		body: form
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export interface SubmitPenerimaParams {
	program_id: number;
	kegiatan_id?: number | null;
	nama: string;
	kategori: 'individu' | 'kelompok' | 'lembaga';
	desa_wilayah: string;
	kontak: string;
	nik: string;
	consent_pdp: boolean;
	signature: File | null;
}

export async function submitPenerima(params: SubmitPenerimaParams) {
	const idToken = await getIdToken();
	const form = new FormData();
	form.append('program_id', String(params.program_id));
	if (params.kegiatan_id) form.append('kegiatan_id', String(params.kegiatan_id));
	form.append('nama', params.nama);
	form.append('kategori', params.kategori);
	form.append('desa_wilayah', params.desa_wilayah);
	form.append('kontak', params.kontak);
	form.append('nik', params.nik);
	form.append('consent_pdp', String(params.consent_pdp));
	if (params.signature) form.append('signature', params.signature);

	const res = await fetch('/api/csr/penerima/submit', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` },
		body: form
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

/** Ambil lokasi GPS sekali (best-effort). Mengembalikan null bila ditolak/tidak tersedia. */
export function getCurrentPosition(): Promise<{ lat: number; lng: number } | null> {
	return new Promise((resolve) => {
		if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
		navigator.geolocation.getCurrentPosition(
			(pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
			() => resolve(null),
			{ enableHighAccuracy: true, timeout: 8000 }
		);
	});
}
