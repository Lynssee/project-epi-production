// src/lib/services/ess/referral.ts
// Client-side service ESS Internal Referral Rekrutmen — selalu lewat /api/ess/referral.

import { auth } from '$lib/firebase';

export interface ReferralJobItem {
	id: number;
	judul_posisi: string;
	departemen: string;
	lokasi: string;
	tipe_pekerjaan: string;
	rentang_gaji: string | null;
	referral_reward_nominal: number | null;
	referral_terms: string | null;
	deskripsi: string | null;
	persyaratan: string | null;
	batas_lamaran: string | null;
	tanggal_posting: string | null;
}

export interface MyReferralItem {
	id: number;
	lowongan_id: number;
	kandidat_id: number;
	referrer_karyawan_id: number;
	hubungan_relasi: string;
	alasan_rekomendasi: string | null;
	status: string;
	reward_amount: number;
	tanggal_rekomendasi: string;
	tanggal_hired: string | null;
	tanggal_probation_selesai: string | null;
	tanggal_reward_cair: string | null;
	catatan_hrd: string | null;
	lowongan?: {
		id: number;
		judul_posisi: string;
		departemen: string;
		lokasi: string;
		referral_reward_nominal: number;
	} | null;
	kandidat?: {
		id: number;
		nama: string;
		email: string | null;
		no_hp: string;
		status: string;
		current_stage: string;
		tanggal_melamar: string;
	} | null;
}

export interface ReferralDataResponse {
	jobs: ReferralJobItem[];
	myReferrals: MyReferralItem[];
	karyawan: {
		id: number;
		nama: string;
		departemen: string;
	};
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

export async function getReferralData(): Promise<ReferralDataResponse> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/referral', {
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function submitReferral(formData: FormData): Promise<{ success: boolean; message: string; referralId: number }> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/referral', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` },
		body: formData
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}
