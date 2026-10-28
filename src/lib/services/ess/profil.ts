// src/lib/services/ess/profil.ts
// Client-side service ESS Profil — selalu lewat /api/ess/profil.

import { auth } from '$lib/firebase';

export interface EssProfil {
	id: number;
	nama_karyawan: string;
	id_karyawan: string | null;
	no_karyawan: string | null;
	divisi: string | null;
	posisi: string | null;
	email_company: string | null;
	tanggal_masuk: string | null;
	status_kerja: string | null;
	status: string | null;
	tempat_lahir: string | null;
	tanggal_lahir: string | null;
	no_ktp: string | null;
	no_kk: string | null;
	no_npwp: string | null;
	alamat_ktp: string | null;
	agama: string | null;
	pendidikan_terakhir: string | null;
	no_hp: string | null;
	kontak_darurat: string | null;
	no_telp_darurat: string | null;
	no_bpjs_kes: string | null;
	no_rekening: string | null;
}

/** Field data diri yang boleh dilengkapi mandiri — harus sinkron dengan EDITABLE_FIELDS di server. */
export const EDITABLE_PROFIL_FIELDS: { key: keyof EssProfil; label: string; type?: 'date' }[] = [
	{ key: 'tempat_lahir', label: 'Tempat Lahir' },
	{ key: 'tanggal_lahir', label: 'Tanggal Lahir', type: 'date' },
	{ key: 'no_ktp', label: 'No. KTP' },
	{ key: 'no_kk', label: 'No. KK' },
	{ key: 'no_npwp', label: 'No. NPWP' },
	{ key: 'alamat_ktp', label: 'Alamat KTP' },
	{ key: 'agama', label: 'Agama' },
	{ key: 'pendidikan_terakhir', label: 'Pendidikan Terakhir' },
	{ key: 'no_hp', label: 'No. HP' },
	{ key: 'kontak_darurat', label: 'Kontak Darurat' },
	{ key: 'no_telp_darurat', label: 'No. Telp Darurat' },
	{ key: 'no_bpjs_kes', label: 'No. BPJS' },
	{ key: 'no_rekening', label: 'No. Rekening' }
];

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

export async function getProfil(): Promise<{ profil: EssProfil | null }> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/profil', {
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function updateProfil(
	patch: Partial<Record<keyof EssProfil, string | null>>
): Promise<{ profil: EssProfil }> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/profil', {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
		body: JSON.stringify(patch)
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}
