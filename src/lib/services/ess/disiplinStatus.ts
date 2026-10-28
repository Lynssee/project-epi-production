// src/lib/services/ess/disiplinStatus.ts
// Client-side service ESS Status Kehadiran & Denda Real-time — selalu lewat
// /api/ess/attendance/disiplin-status. Read-only.

import { auth } from '$lib/firebase';

export interface TelatItem {
	tanggal: string;
	jamMasuk: string;
	menitTelat: number;
	estimasiDenda: number;
}

export interface IzinItem {
	tanggal: string;
	status: string;
	jamMasuk: string | null;
}

export interface KuotaKerjaBulanIni {
	hariKurangKuota: number;
	rincianHari: { tanggal: string; jamKerja: number }[];
	hariDievaluasi: number;
}

export interface KepatuhanLaporanBulanIni {
	sudahLaporHariIni: boolean;
	wajibLaporHariIni: boolean;
	hariBolongBulanIni: number;
	batasJam: string;
}

export interface DisiplinStatus {
	aktif: boolean;
	periode?: string;
	// Memo HRD 018/MEMO/HRD/VIII/2026: true untuk Project Leader/Coordinator — bebas denda jam
	// masuk, kepatuhan diukur dari kuotaKerja & kepatuhanLaporan (bukan hariTerlambat).
	isLeader?: boolean;
	kuotaKerja?: KuotaKerjaBulanIni | null;
	kepatuhanLaporan?: KepatuhanLaporanBulanIni | null;
	hariTerlambat?: number;
	estimasiDendaTerlambat?: number;
	maxMenitTelat?: number;
	izinTerpakaiBulanIni?: number;
	sisaToleransiIzin?: number;
	toleransiIzinQuota?: number;
	ambang?: { teguranLisan: number; teguranTertulis: number; sp: number };
	posisiSaatIni?: 'aman' | 'mendekati_teguran_lisan' | 'mendekati_teguran_tertulis' | 'mendekati_sp';
	rincianTelat?: TelatItem[];
	rincianIzin?: IzinItem[];
	jamMasukNormalFormatted?: string;
	toleransiMenit?: number;
	tarifPerJam?: number;
	metodePembulatan?: string;
	totalHariKerjaTercatat?: number;
	totalTepatWaktu?: number;
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

export async function getDisiplinStatus(): Promise<DisiplinStatus> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/attendance/disiplin-status', {
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}
