// src/lib/services/ess/reimburse.ts
// Client-side service ESS Reimbursement — selalu lewat /api/ess/reimburse/*.

import { compressPhoto } from '$lib/utils/photoCompress';
import { auth } from '$lib/firebase';

export interface ReimburseRecord {
	id: string;
	karyawan_id: string;
	tanggal_pengajuan: string;
	kategori: string;
	jumlah: number;
	status: string;
	catatan: string | null;
	approver_id: string | null;
	approved_at: string | null;
	bukti_pendukung?: string | null;
	karyawan?: {
		id: number;
		nama_karyawan: string;
		divisi: string | null;
		posisi: string | null;
		foto?: string | null;
	} | null;
}

async function getIdToken(): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return user.getIdToken();
}

async function parseErrorMessage(res: Response): Promise<string> {
	if (res.status === 413) {
		return 'Ukuran foto struk terlalu besar (melebihi batas server). Silakan ambil ulang foto dengan resolusi standar atau tanpa mode HDR.';
	}
	try {
		const data = await res.json();
		const msg = data?.message || '';
		if (/payload too large|body_size_limit|exceeded limit/i.test(msg)) {
			return 'Ukuran foto struk terlalu besar. Silakan coba ambil ulang dengan resolusi standar.';
		}
		return msg || `Gagal (${res.status})`;
	} catch {
		return `Gagal (${res.status})`;
	}
}

export async function getReimburseStatus(): Promise<{ riwayat: ReimburseRecord[] }> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/reimburse/status', { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export interface AjukanReimburseParams {
	kategori: string;
	jumlah: number;
	catatan: string;
	buktiFile: File | null;
	// "4-Gate Site Visit System" Fase 3b (8 Sep 2026) — G_RMR_VISIT (Transport/Perjalanan Dinas).
	siteCheckinId?: string | null;
	visitException?: string | null;
}

export async function ajukanReimburse(params: AjukanReimburseParams): Promise<{ record: ReimburseRecord }> {
	const idToken = await getIdToken();
	const formData = new FormData();
	formData.append('kategori', params.kategori);
	formData.append('jumlah', String(params.jumlah));
	formData.append('catatan', params.catatan);
	if (params.siteCheckinId) formData.append('site_checkin_id', params.siteCheckinId);
	if (params.visitException) formData.append('visit_exception', params.visitException);
	if (params.buktiFile) {
		const compressed = await compressPhoto(params.buktiFile);
		formData.append('bukti_pendukung', compressed, compressed.name || 'bukti.jpg');
	}

	const res = await fetch('/api/ess/reimburse', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` },
		body: formData
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function getReimburseApprovalInbox(): Promise<{ inbox: ReimburseRecord[]; history?: ReimburseRecord[] }> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/reimburse/approval', { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function approveReimburse(id: string): Promise<{ record: ReimburseRecord }> {
	const idToken = await getIdToken();
	const res = await fetch(`/api/ess/reimburse/${id}/approve`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function rejectReimburse(id: string, alasan: string): Promise<{ record: ReimburseRecord }> {
	const idToken = await getIdToken();
	const res = await fetch(`/api/ess/reimburse/${id}/reject`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
		body: JSON.stringify({ alasan })
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}
