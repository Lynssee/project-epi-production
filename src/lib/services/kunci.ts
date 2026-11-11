// src/lib/services/kunci.ts
// Klien Key Management pos satpam: semua lewat /api/satpam/kunci/* (server menulis & mengevaluasi gate G_SEC8).

import { auth } from '$lib/firebase';

export interface KunciItem {
	id: number;
	kode_kunci: string;
	nama_kunci: string;
	kategori: string | null;
	tipe_salinan: string | null;
	lokasi_kotak: string | null;
	nomor_hook: string | null;
	qr_tag: string | null;
	status: string;
	pemegang_sekarang_id: number | null;
	pemegang_nama: string | null;
	is_restricted: boolean | null;
	waktu_pinjam: string | null;
	rencana_kembali: string | null;
	terlambat: boolean;
}

export interface KunciRingkasan {
	total: number;
	tersedia: number;
	dipinjam: number;
	izin_bawa_pulang: number;
	terlambat: number;
}

export interface SlotKunci {
	id: number;
	kode: string;
	nama: string;
	status: string;
	lokasi_kotak: string | null;
	nomor_hook: string | null;
	is_restricted: boolean;
	pemegang_nama: string | null;
}

export interface RekonsiliasiKunci {
	total: number;
	di_slot: number;
	cocok: boolean;
	belum_kembali: SlotKunci[];
	izin_bawa_pulang: SlotKunci[];
	/** Semua kunci operasional urut kotak → slot; yang berstatus `tersedia` dicentang satpam. */
	slots: SlotKunci[];
}

/** Error dari API kunci; `status` 422 = gate soft meminta alasan (isi `gate_sec8_reason` lalu kirim ulang). */
export class KunciError extends Error {
	constructor(
		message: string,
		public status: number
	) {
		super(message);
	}
}

async function call<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
	const user = auth.currentUser;
	if (!user) throw new KunciError('Sesi tidak ditemukan. Silakan login ulang.', 401);
	const idToken = await user.getIdToken();
	const res = await fetch(url, {
		method: init.method ?? 'GET',
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
		body: init.body !== undefined ? JSON.stringify(init.body) : undefined
	});
	if (!res.ok) {
		let message = `Gagal (${res.status})`;
		try {
			message = (await res.json())?.message || message;
		} catch {
			/* pakai pesan default */
		}
		throw new KunciError(message, res.status);
	}
	return res.json();
}

export const fetchKunci = () => call<{ items: KunciItem[]; ringkasan: KunciRingkasan }>('/api/satpam/kunci');

export interface KunciSlotKendaraan {
	kode: string;
	lokasi_kotak: string | null;
	nomor_hook: string | null;
	status: string;
}

/** Slot kunci per kendaraan untuk tiket booking (kendaraan tanpa kunci terdaftar tidak ada di hasil). */
export const fetchKunciSlotKendaraan = (vehicleIds: number[]) =>
	call<{ slots: Record<number, KunciSlotKendaraan> }>(`/api/fleet-booking/kunci-slot?vehicle_ids=${encodeURIComponent(vehicleIds.join(','))}`);

export const fetchRekonsiliasiKunci =() => call<RekonsiliasiKunci>('/api/satpam/kunci/rekonsiliasi');

export interface AtasanPeminjam {
	id: number;
	nama: string;
	jenis: 'langsung' | 'fungsional';
}

export const fetchAtasanPeminjam = (karyawanId: number) =>
	call<{ atasan: AtasanPeminjam[] }>(`/api/satpam/kunci/atasan?karyawan_id=${encodeURIComponent(String(karyawanId))}`);

export const pinjamKunci = (payload: {
	key_id: number;
	peminjam_id: number;
	rencana_kembali?: string;
	catatan?: string;
	gate_sec8_reason?: string;
	izin_atasan_id?: number;
	darurat?: boolean;
}) => call<{ status: string; rencana_kembali: string; gate: { decision: string; summary: string } | null }>('/api/satpam/kunci/pinjam', { method: 'POST', body: payload });

export const kembalikanKunci = (payload: { key_id: number; kondisi_fisik?: 'lengkap_baik' | 'rusak' | 'hilang'; catatan?: string }) =>
	call<{ status: string }>('/api/satpam/kunci/kembali', { method: 'POST', body: payload });

/** Cocokkan hasil scan QR ("KEY:<qr_tag>") atau ketikan manual dengan daftar kunci yang sudah dimuat. */
export function cariKunciLokal(items: KunciItem[], raw: string): KunciItem | null {
	const token = String(raw ?? '')
		.trim()
		.replace(/^KEY:/i, '')
		.trim()
		.toLowerCase();
	if (!token) return null;
	return items.find((k) => (k.qr_tag ?? '').toLowerCase() === token || (k.kode_kunci ?? '').toLowerCase() === token) ?? null;
}
