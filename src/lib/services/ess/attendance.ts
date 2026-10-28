// src/lib/services/ess/attendance.ts
// Client-side service ESS Absensi — SELALU lewat /api/ess/*, TIDAK PERNAH akses
// Directus langsung dari sini (token admin tidak boleh ikut ke fitur karyawan).

import { auth } from '$lib/firebase';
import { compressPhoto } from '$lib/utils/photoCompress';
import { watermarkPhoto } from '$lib/utils/photoWatermark';

export interface LokasiAbsensiOption {
	id: string;
	nama: string;
	lat: number;
	lng: number;
	radius_m: number;
}

export interface AbsensiHarianRecord {
	id: string;
	tanggal: string;
	status: string;
	jam_masuk: string | null;
	jam_keluar: string | null;
	masuk_valid: boolean | null;
	pulang_valid: boolean | null;
	[key: string]: any;
}

export interface IstirahatKategoriOption {
	id: string;
	nama: string;
	hitung_kuota: boolean;
	kuota_menit_sendiri: number | null;
	foto_wajib: boolean | null;
	urutan: number;
}

export interface IstirahatJedaTerbuka {
	id: string;
	kategori_id: string | null;
	jam_keluar: string | null;
}

export interface IstirahatJedaHariIni {
	id: string;
	kategoriNama: string | null;
	jam_keluar: string | null;
	jam_masuk: string | null;
	durasi_menit: number | null;
	overrun_menit: number | null;
	tier: number | null;
	foto_masuk: string | null;
}

export interface TodayStatus {
	record: AbsensiHarianRecord | null;
	lokasiOptions: LokasiAbsensiOption[];
	tanggal: string;
	istirahat: {
		aktif: boolean;
		kategoriAktif: IstirahatKategoriOption[];
		konfig: {
			foto_masuk_wajib: boolean;
			foto_keluar_wajib: boolean;
			min_durasi_menit: number;
			blokir_pulang: boolean;
			makan_siang_menit: number;
		} | null;
		jendela: { mulai: string | null; selesai: string | null } | null;
		jedaTerbuka: IstirahatJedaTerbuka | null;
		jedaHariIni: IstirahatJedaHariIni[];
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
		if (data?.message) return data.message;
	} catch {
		/* non-json response */
	}
	if (res.status === 401) return 'Sesi Anda telah kedaluwarsa. Silakan muat ulang halaman atau login kembali.';
	if (res.status === 403) return 'Akun Anda belum tertaut ke data karyawan. Silakan hubungi HRD.';
	if (res.status >= 500) return 'Layanan absensi sedang mengalami gangguan. Silakan coba beberapa saat lagi.';
	return `Gagal memuat data (${res.status})`;
}

async function fetchWithRetry(url: string, init: RequestInit, maxRetries = 1): Promise<Response> {
	let lastError: any = null;
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fetch(url, init);
		} catch (err: any) {
			lastError = err;
			if (attempt < maxRetries) {
				await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
				continue;
			}
		}
	}
	const errText = String(lastError?.message || '');
	if (errText.includes('Failed to fetch') || errText.includes('NetworkError') || errText.includes('net::ERR')) {
		throw new Error('Koneksi ke server terputus. Silakan periksa jaringan Anda atau coba beberapa saat lagi.');
	}
	throw lastError || new Error('Gagal menghubungi server absensi.');
}

export async function getTodayStatus(): Promise<TodayStatus> {
	const idToken = await getIdToken();
	const res = await fetchWithRetry('/api/ess/attendance/status', {
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export interface RiwayatAbsensiResult {
	rows: AbsensiHarianRecord[];
	periode: { dari: string; sampai: string };
	karyawan: { id: number; nama: string };
}

/** Riwayat absensi milik sendiri pada rentang tanggal (default 30 hari terakhir). */
export async function getRiwayatAbsensi(
	opts: { dari?: string; sampai?: string } = {}
): Promise<RiwayatAbsensiResult> {
	const idToken = await getIdToken();
	const qs = new URLSearchParams();
	if (opts.dari) qs.set('dari', opts.dari);
	if (opts.sampai) qs.set('sampai', opts.sampai);
	const url = '/api/ess/attendance/riwayat' + (qs.toString() ? `?${qs}` : '');
	const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

interface PunchParams {
	lat: number;
	lng: number;
	accuracy?: number | null;
	lokasiAbsensiId?: string | null;
	photoFile: File;
	livenessPassed?: boolean;
}

async function submitPunch(endpoint: string, params: PunchParams): Promise<any> {
	const idToken = await getIdToken();
	const gps = { lat: params.lat, lng: params.lng, accuracy: params.accuracy ?? 0 };
	const watermarked = await watermarkPhoto(params.photoFile, gps);
	const compressed = await compressPhoto(watermarked);

	const formData = new FormData();
	formData.append('lat', String(params.lat));
	formData.append('lng', String(params.lng));
	if (params.accuracy != null) formData.append('accuracy', String(params.accuracy));
	if (params.lokasiAbsensiId) formData.append('lokasi_absensi_id', params.lokasiAbsensiId);
	formData.append('foto', compressed, compressed.name || 'selfie.jpg');
	formData.append('liveness_passed', params.livenessPassed ? 'true' : 'false');

	const res = await fetch(endpoint, {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` },
		body: formData
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export function clockIn(params: PunchParams) {
	return submitPunch('/api/ess/attendance/clock-in', params);
}

export function clockOut(params: PunchParams) {
	return submitPunch('/api/ess/attendance/clock-out', params);
}

interface BreakPunchParams {
	lat: number;
	lng: number;
	accuracy?: number | null;
	lokasiAbsensiId?: string | null;
	photoFile?: File | null;
	livenessPassed?: boolean;
	kategoriId?: string | null;
	// Fase 2 (rencana absensi istirahat v2 §3.2) — mode "istirahat di perjalanan", khusus pola
	// kerja mobile. Di break-out mengizinkan skip foto (foto_ditunda); di break-in dipakai
	// fallback klasifikasi konteks bila tidak ada geofence/site_checkin yang cocok.
	perjalanan?: boolean;
	// Fase 3 (rencana absensi istirahat v2 §3.1) — payload Dynamic Screen QR meja desk yang
	// dipindai dari layar PC sendiri. Opsional, hanya dipakai break-in.
	wstnPayload?: string | null;
	// Fase 2 §5 — tombol "Ubah lokasi": karyawan mengoreksi chip konteks otomatis sebelum
	// kirim. Hanya dipakai break-in, hanya berlaku utk pola kerja mobile di sisi server.
	konteksOverride?: string | null;
}

async function submitBreakPunch(endpoint: string, params: BreakPunchParams): Promise<any> {
	const idToken = await getIdToken();
	const formData = new FormData();
	formData.append('lat', String(params.lat));
	formData.append('lng', String(params.lng));
	if (params.accuracy != null) formData.append('accuracy', String(params.accuracy));
	if (params.lokasiAbsensiId) formData.append('lokasi_absensi_id', params.lokasiAbsensiId);
	if (params.kategoriId) formData.append('kategori_id', params.kategoriId);
	formData.append('liveness_passed', params.livenessPassed ? 'true' : 'false');
	if (params.perjalanan) formData.append('perjalanan', 'true');
	if (params.wstnPayload) formData.append('wstn_payload', params.wstnPayload);
	if (params.konteksOverride) formData.append('konteks_override', params.konteksOverride);

	if (params.photoFile) {
		const gps = { lat: params.lat, lng: params.lng, accuracy: params.accuracy ?? 0 };
		const watermarked = await watermarkPhoto(params.photoFile, gps);
		const compressed = await compressPhoto(watermarked);
		formData.append('foto', compressed, compressed.name || 'selfie.jpg');
	}

	const res = await fetch(endpoint, {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` },
		body: formData
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

/** Mulai istirahat — foto opsional (tergantung konfigurasi/kategori), kategori WAJIB. */
export function breakOut(params: BreakPunchParams) {
	return submitBreakPunch('/api/ess/attendance/break-out', params);
}

/** Kembali dari istirahat — foto WAJIB (keputusan produk: foto hanya wajib saat kembali). */
export function breakIn(params: BreakPunchParams & { photoFile: File }) {
	return submitBreakPunch('/api/ess/attendance/break-in', params);
}

/**
 * Pratinjau chip konteks lokasi SEBELUM submit (rencana v2 §5 Fase 2) — dipanggil begitu GPS
 * didapat saat break-in, supaya karyawan bisa mengoreksi lewat tombol "Ubah lokasi". Gagal-lunak:
 * pemanggil harus menyembunyikan chip bila ini melempar, jangan pernah memblokir absen karenanya.
 */
export async function previewKonteksLokasi(lat: number, lng: number): Promise<{ konteksLokasi: string | null; konteksSumber: string | null }> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/attendance/konteks-preview', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ lat, lng })
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}
