// src/lib/services/ess/dataKelengkapan.ts
// Client-side wrapper untuk /api/ess/data-lengkap — status countdown kelengkapan data
// karyawan baru, dipakai DataCompletionCountdown.svelte di dashboard ESS.

import { auth } from '$lib/firebase';

export interface KelengkapanMissing {
	tipe: 'field' | 'dokumen';
	key: string;
	label: string;
}

export interface DataLengkapStatus {
	berlaku: boolean;
	lengkap: boolean;
	missing: KelengkapanMissing[];
	/** Item opsional yang belum diisi (BPJS, Ijazah, Kontak Darurat, NPWP) — saran, tidak mengunci. */
	opsional?: KelengkapanMissing[];
	persen: number;
	deadline: string | null;
	sudahLewat: boolean;
	mode: 'ok' | 'warn' | 'block';
	sumber: 'onboarding' | 'universal';
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

export async function getDataLengkapStatus(): Promise<DataLengkapStatus> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/data-lengkap', {
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}
