// src/lib/services/ess/cuti.ts
// Client-side service ESS Cuti — SELALU lewat /api/ess/cuti/*, TIDAK PERNAH akses
// Directus langsung (sama prinsipnya dengan services/ess/attendance.ts).

import { auth } from '$lib/firebase';
import { compressPhoto } from '$lib/utils/photoCompress';

export interface CutiRecord {
	id: string;
	karyawan_id: string;
	jenis_cuti: string;
	tanggal_mulai: string;
	tanggal_selesai: string;
	jumlah_hari: number;
	/** 'pagi' | 'siang' — hanya terisi saat cuti 1/2 hari (jumlah_hari = 0.5). */
	paruh?: 'pagi' | 'siang' | null;
	status: string;
	alasan: string | null;
	disetujui_oleh: string | null;
	catatan_hr: string | null;
	approver_id: string | null;
	approved_at: string | null;
	delegasi_karyawan_id?: number | { id: number; nama_karyawan: string } | null;
	delegasi_catatan?: string | null;
	/** UUID file directus_files — lampiran dokumen pendukung (mis. surat dokter untuk Cuti Sakit). */
	lampiran?: string | null;
	karyawan?: {
		id: number;
		nama_karyawan: string;
		divisi: string | null;
		posisi: string | null;
		foto?: string | null;
	} | null;
}

export interface SisaCuti {
	total_hak: number;
	terpakai: number;
	sisa: number;
	terpakai_pengajuan: number;
	potongan_cuti_bersama: number;
}

export interface CutiStatus {
	riwayat: CutiRecord[];
	sisaCuti: SisaCuti;
}

export interface ApprovalInbox {
	inbox: CutiRecord[];
	history?: CutiRecord[];
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
	// FormData harus tanpa Content-Type manual supaya boundary multipart ditetapkan browser.
	const isForm = options.body instanceof FormData;
	return fetch(url, {
		...options,
		headers: {
			...(options.body && !isForm ? { 'Content-Type': 'application/json' } : {}),
			Authorization: `Bearer ${idToken}`,
			...(options.headers || {})
		}
	});
}

export async function getCutiStatus(): Promise<CutiStatus> {
	const res = await authedFetch('/api/ess/cuti/status');
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export interface AjukanCutiParams {
	jenis_cuti: string;
	sub_jenis_cuti_khusus?: string;
	tanggal_mulai: string;
	tanggal_selesai: string;
	/** 'pagi' | 'siang' untuk cuti 1/2 hari (hanya bila tanggal_mulai === tanggal_selesai). */
	paruh?: 'pagi' | 'siang' | null;
	alasan: string;
	delegasi_karyawan_id: number | string;
	delegasi_catatan: string;
	/** Lampiran dokumen pendukung (mis. surat dokter untuk Cuti Sakit). Opsional untuk jenis lain. */
	lampiranFile?: File | null;
}

export async function ajukanCuti(params: AjukanCutiParams): Promise<{ record: CutiRecord }> {
	const fd = new FormData();
	fd.append('jenis_cuti', params.jenis_cuti);
	if (params.sub_jenis_cuti_khusus) fd.append('sub_jenis_cuti_khusus', params.sub_jenis_cuti_khusus);
	fd.append('tanggal_mulai', params.tanggal_mulai);
	fd.append('tanggal_selesai', params.tanggal_selesai);
	if (params.paruh) fd.append('paruh', params.paruh);
	fd.append('alasan', params.alasan);
	fd.append('delegasi_karyawan_id', String(params.delegasi_karyawan_id));
	fd.append('delegasi_catatan', params.delegasi_catatan);
	if (params.lampiranFile) {
		const file = params.lampiranFile.type.startsWith('image/')
			? await compressPhoto(params.lampiranFile)
			: params.lampiranFile;
		fd.append('lampiran', file, file.name || 'lampiran.jpg');
	}

	const res = await authedFetch('/api/ess/cuti', {
		method: 'POST',
		body: fd
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export interface AturanPengajuanCuti {
	minimumHari: number;
	hariIni: string;
	tanggalMinimum: string;
	jenisDikecualikan: string[];
}

export async function fetchAturanPengajuanCuti(): Promise<AturanPengajuanCuti> {
	const res = await authedFetch('/api/ess/cuti/aturan');
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export interface DelegasiKandidat {
	id: number;
	nama_karyawan: string;
}

export async function fetchDelegasiKandidat(): Promise<DelegasiKandidat[]> {
	const res = await authedFetch('/api/ess/cuti/delegasi-kandidat');
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	const data = await res.json();
	return data?.employees || [];
}

export async function getApprovalInbox(): Promise<ApprovalInbox> {
	const res = await authedFetch('/api/ess/cuti/approval');
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function approveCuti(id: string): Promise<{ record: CutiRecord }> {
	const res = await authedFetch(`/api/ess/cuti/${id}/approve`, { method: 'POST' });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function rejectCuti(id: string, alasan: string): Promise<{ record: CutiRecord }> {
	const res = await authedFetch(`/api/ess/cuti/${id}/reject`, {
		method: 'POST',
		body: JSON.stringify({ alasan })
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}
