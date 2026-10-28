// src/lib/services/ess/izinSakit.ts
// Client-side service ESS Izin/Sakit — SELALU lewat /api/ess/attendance/izin-sakit,
// TIDAK PERNAH akses Directus langsung (sama prinsipnya dengan services/ess/attendance.ts).

import { auth } from '$lib/firebase';
import { compressPhoto } from '$lib/utils/photoCompress';

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

export interface AjukanIzinSakitParams {
	jenis: 'izin' | 'sakit' | 'izin_setengah_hari' | 'izin_terlambat';
	alasan: string;
	suratFile?: File | null;
	/** Khusus jenis 'sakit': tanggal terakhir sakit (rentang mulai hari ini). Maks 5 hari kalender. */
	tanggalSelesai?: string | null;
	/** Wajib untuk jenis 'izin_setengah_hari': sesi mana yang diambil. */
	sesi?: 'PAGI' | 'SIANG' | null;
	/** Wajib: karyawan yang menerima delegasi tugas selama pemohon tidak hadir. */
	delegasiKaryawanId: number | string;
	/** Wajib: tugas/tanggung jawab yang didelegasikan. */
	delegasiCatatan: string;
}

export async function ajukanIzinSakit(params: AjukanIzinSakitParams): Promise<{ record: any }> {
	const idToken = await getIdToken();

	const formData = new FormData();
	formData.append('jenis', params.jenis);
	formData.append('alasan', params.alasan);
	if (params.jenis === 'sakit' && params.tanggalSelesai) {
		formData.append('tanggal_selesai', params.tanggalSelesai);
	}
	if (params.jenis === 'izin_setengah_hari' && params.sesi) {
		formData.append('sesi', params.sesi);
	}
	if (params.suratFile) {
		const compressed = await compressPhoto(params.suratFile);
		formData.append('surat', compressed, compressed.name || 'surat.jpg');
	}
	formData.append('delegasi_karyawan_id', String(params.delegasiKaryawanId));
	formData.append('delegasi_catatan', params.delegasiCatatan);

	const res = await fetch('/api/ess/attendance/izin-sakit', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` },
		body: formData
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export interface IzinSakitRecord {
	id: string;
	tanggal: string;
	status: string;
	keterangan: string | null;
	foto_surat_dokter: string | null;
	kelompok_sakit_id?: string | null;
	jam_masuk?: string | null;
	jam_keluar?: string | null;
	sumber?: string | null;
	date_created?: string;
	tipe_durasi?: string | null;
	sesi?: string | null;
	jam_mulai_izin?: string | null;
	jam_selesai_izin?: string | null;
	total_durasi_jam?: number | null;
	potongan_hari?: number | null;
}

export interface IzinSakitSummary {
	totalIzinBulanIni: number;
	sakitTerverifikasiBulanIni: number;
	sakitPendingBulanIni: number;
	izinTerlambatBulanIni: number;
}

export interface IzinSakitHistoryResponse {
	records: IzinSakitRecord[];
	summary: IzinSakitSummary;
	today: string;
}

export async function getIzinSakitHistory(): Promise<IzinSakitHistoryResponse> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/attendance/izin-sakit', {
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}
