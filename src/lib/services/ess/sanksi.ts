// src/lib/services/ess/sanksi.ts
// Client-side service ESS Sanksi (bagian dari /ess/disiplin) — daftar sanksi pribadi + tanda
// terima digital + banding. SELALU lewat /api/ess/disiplin/sanksi/*, TIDAK PERNAH akses Directus
// langsung.

import { auth } from '$lib/firebase';

export interface SanksiRecord {
	id: number;
	jenis_sanksi: string;
	kategori_pelanggaran: string | null;
	deskripsi_pelanggaran: string | null;
	tanggal_sanksi: string | null;
	tanggal_berlaku: string | null;
	tanggal_berakhir: string | null;
	status: string;
	catatan_banding: string | null;
	karyawan_ack_at: string | null;
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

export async function getMySanksi(): Promise<SanksiRecord[]> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/disiplin/sanksi', { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	const body = await res.json();
	return body.sanksi;
}

export async function acknowledgeSanksi(sanksiId: number): Promise<void> {
	const idToken = await getIdToken();
	const res = await fetch(`/api/ess/disiplin/sanksi/${sanksiId}/ack`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
}

export async function submitBanding(sanksiId: number, alasan: string): Promise<void> {
	const idToken = await getIdToken();
	const res = await fetch(`/api/ess/disiplin/sanksi/${sanksiId}/banding`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
		body: JSON.stringify({ alasan })
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
}
