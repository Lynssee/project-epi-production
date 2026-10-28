// src/lib/services/ess/dokumen.ts
// Client-side service ESS Dokumen Pribadi — selalu lewat /api/ess/dokumen/*.
// File dibuka via fetch+Blob (BUKAN <a href> langsung) karena endpoint butuh
// header Authorization Bearer, bukan cookie session.

import { openPlaceholderWindow } from '$lib/utils/openWindowAsync';
import { auth } from '$lib/firebase';

export interface EssDokumen {
	id: number;
	tipe_dokumen: string;
	nama_dokumen: string;
	tanggal_upload: string | null;
	tanggal_berlaku: string | null;
	tanggal_expired: string | null;
	status: string | null;
	notes: string | null;
	is_confidential: boolean;
	is_encrypted: boolean;
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

export async function getDokumenList(): Promise<{ dokumen: EssDokumen[] }> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/dokumen', {
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

/** Jenis dokumen yang boleh diunggah mandiri — harus sinkron dengan SELF_UPLOAD_TYPES di server. */
export const SELF_UPLOAD_DOKUMEN_TYPES: { value: string; label: string }[] = [
	{ value: 'ktp', label: 'KTP' },
	{ value: 'kk', label: 'KK' },
	{ value: 'npwp', label: 'NPWP' },
	{ value: 'pas_foto', label: 'Pas Foto' },
	{ value: 'ijazah', label: 'Ijazah' },
	{ value: 'bpjs', label: 'BPJS' },
	{ value: 'sertifikat', label: 'Sertifikat' }
];

export async function uploadDokumen(tipeDokumen: string, file: File): Promise<{ dokumen: EssDokumen }> {
	const idToken = await getIdToken();
	const formData = new FormData();
	formData.append('tipe_dokumen', tipeDokumen);
	formData.append('file', file, file.name);

	const res = await fetch('/api/ess/dokumen', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` },
		body: formData
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

/** Fetch berkas dokumen (didekripsi server bila perlu) dan buka sebagai Blob URL di tab baru. */
export async function openDokumenFile(id: number): Promise<void> {
	// PRJ-28 (Aturan #5): buka jendela SINKRON sebelum await (token & fetch).
	const w = openPlaceholderWindow();
	try {
		const idToken = await getIdToken();
		const res = await fetch(`/api/ess/dokumen/${id}/file`, {
			headers: { Authorization: `Bearer ${idToken}` }
		});
		if (!res.ok) throw new Error(await parseErrorMessage(res));
		const blob = await res.blob();
		w.navigate(URL.createObjectURL(blob));
	} catch (e) {
		w.cancel();
		throw e;
	}
}
