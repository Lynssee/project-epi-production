// src/lib/services/ess/kasbon.ts
// Client-side service ESS Kasbon — SELALU lewat /api/ess/kasbon/*, TIDAK PERNAH akses
// Directus langsung (sama prinsipnya dengan services/ess/cuti.ts).

import { auth } from '$lib/firebase';

export interface JadwalAngsuranBaris {
	periode: string;
	urutan: number;
	nominal_rencana: number;
	status: 'terbayar' | 'proyeksi';
}

export interface KasbonPaymentLogBaris {
	id: string;
	periode: string;
	nominal_potongan: number;
	tanggal: string;
}

export interface KasbonRecord {
	id: number;
	karyawan_id: number;
	nominal: number;
	tenor: number;
	keterangan: string | null;
	status: string;
	tanggal_pengajuan: string;
	cicilan_per_bulan: number | null;
	total_paid: number;
	payment_status: string;
	catatan_penolakan: string | null;
	/** Fase 4 (T10): proyeksi jadwal angsuran, hanya terisi untuk kasbon berstatus approved. */
	jadwalAngsuran?: JadwalAngsuranBaris[];
	/** Fase 4 (R5): riwayat potongan aktual per periode. */
	riwayatPotongan?: KasbonPaymentLogBaris[];
	karyawan?: {
		id: number;
		nama_karyawan: string;
		divisi: string | null;
		posisi: string | null;
		foto?: string | null;
	} | null;
}

export interface KasbonStatus {
	riwayat: KasbonRecord[];
	plafon: number;
	tenorMaxBulan: number;
	maxAktif: number;
	jumlahAktif: number;
	sisaAktif: number;
	bisaAjukanBaru: boolean;
}

export interface KasbonApprovalInbox {
	inbox: KasbonRecord[];
	history?: KasbonRecord[];
	divisi: string | null;
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

export async function getKasbonStatus(): Promise<KasbonStatus> {
	const res = await authedFetch('/api/ess/kasbon/status');
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export interface AjukanKasbonParams {
	nominal: number;
	tenor: number;
	keterangan: string;
}

export async function ajukanKasbon(params: AjukanKasbonParams): Promise<{ record: KasbonRecord }> {
	const res = await authedFetch('/api/ess/kasbon', {
		method: 'POST',
		body: JSON.stringify(params)
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function getKasbonApprovalInbox(): Promise<KasbonApprovalInbox> {
	const res = await authedFetch('/api/ess/kasbon/approval');
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function approveKasbon(id: number | string): Promise<{ record: KasbonRecord }> {
	const res = await authedFetch(`/api/ess/kasbon/${id}/approve`, { method: 'POST' });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function rejectKasbon(id: number | string, alasan: string): Promise<{ record: KasbonRecord }> {
	const res = await authedFetch(`/api/ess/kasbon/${id}/reject`, {
		method: 'POST',
		body: JSON.stringify({ alasan })
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}
