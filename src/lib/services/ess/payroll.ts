// src/lib/services/ess/payroll.ts
// Client-side service ESS Slip Gaji — selalu lewat /api/ess/payroll/*.

import { auth } from '$lib/firebase';

export interface PayrollSlip {
	id: string;
	periode: string;
	status: string;
	catatan?: string | null;
	gaji_pokok: number;
	tunjangan: number;
	tunjangan_jabatan: number;
	tunjangan_makan: number;
	tunjangan_transport: number;
	tunjangan_lainnya: number;
	uang_lembur: number;
	reimbursement: number;
	potongan: number;
	potongan_terlambat: number;
	potongan_alpa: number;
	potongan_bpjs_kesehatan: number;
	potongan_bpjs_ketenagakerjaan: number;
	potongan_pph21: number;
	potongan_kasbon: number;
	potongan_lainnya: number;
	potongan_lain_lain?: number;
	gaji_bersih: number;
	tanggal_dibayar: string | null;
	metode_pembayaran: string | null;
	kpi_skor?: number | null;
	kpi_bonus?: number | null;
	kpi_breakdown?: { kategori: string; skor: number; bobot: number; kontribusi_bonus: number }[];
	kpi_management_id?: string | null;
	rincianAbsensi?: {
		telat: { tanggal: string; menitTelat: number }[];
		alpa: string[];
	};
	historyGaji?: any[];
	absensiList?: any[];
	kasbonList?: any[];
	kpiList?: any[];
	rincianPotonganLain?: {
		id: number;
		kategori: string;
		nominal: number;
		cicilan_per_bulan: number;
		payment_status: string | null;
		keterangan: string | null;
		denda_periode: string | null;
	}[];
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

export async function getPayrollStatus(): Promise<{ slips: PayrollSlip[] }> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/payroll/status', {
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}
