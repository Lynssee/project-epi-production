// src/lib/services/opnameSesiApi.ts
// Lifecycle Inventory Tahap 6 — F4: klien Stock Opname berbasis sesi untuk lapangan. Semua lewat /api/opname-sesi
// (server menegakkan blind count & identitas penghitung).

import { getIdToken } from './secureDirectus';

export interface SesiRingkas {
	id: number;
	kode: string;
	status: string;
	gudang_id: number | null;
	gudang_nama: string | null;
	total_lines: number;
	counted_lines: number;
	pic_hitung: string | null;
	mine: boolean;
	jadwal_tanggal: string | null;
	recount_lines: number;
}

export interface BarisHitung {
	id: number;
	item_id: number;
	nama: string;
	kode_item: string | null;
	satuan: string | null;
	rak_id: number | null;
	rak_nama: string | null;
	status: 'pending' | 'counted' | 'recount' | 'ok' | string;
	qty_fisik: number | null;
	alasan_selisih: string | null;
	catatan: string | null;
	has_foto: boolean;
	qty_sistem: number | null; // null saat blind count
}

export interface EntriHitung {
	lineId: number;
	qtyFisik: number | null;
	alasan?: string | null;
	catatan?: string | null;
	foto?: string | null;
}

export interface HasilSimpan {
	lineId: number;
	ok: boolean;
	perlu_bukti?: boolean;
	error?: string;
}

/** Alasan selisih — cermin erp-epi lib/inventory/opnameSession.js ALASAN_SELISIH. */
export const ALASAN_SELISIH = [
	{ value: 'salah_hitung', label: 'Salah hitung / catat sebelumnya' },
	{ value: 'rusak', label: 'Rusak / tidak layak pakai' },
	{ value: 'hilang', label: 'Hilang' },
	{ value: 'salah_satuan', label: 'Salah satuan' },
	{ value: 'belum_tercatat', label: 'Transaksi belum tercatat' },
	{ value: 'lainnya', label: 'Lainnya (isi catatan)' }
];

async function call(path: string, init?: RequestInit) {
	const token = await getIdToken();
	const res = await fetch(path, {
		...init,
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) }
	});
	const data = await res.json().catch(() => null);
	if (!res.ok) throw Object.assign(new Error(data?.message || `Gagal (${res.status})`), { status: res.status });
	return data;
}

export async function fetchSesiAktif(): Promise<{ sesi: SesiRingkas[]; toleransi_pct: number }> {
	return call('/api/opname-sesi');
}

export async function fetchDetailSesi(id: number): Promise<{ session: { id: number; kode: string; status: string; blind_count: boolean; total_lines: number; counted_lines: number }; lines: BarisHitung[] }> {
	return call(`/api/opname-sesi?id=${id}`);
}

export async function simpanHitungan(id: number, entries: EntriHitung[]): Promise<{ hasil: HasilSimpan[]; counted_lines: number }> {
	return call('/api/opname-sesi', { method: 'POST', body: JSON.stringify({ action: 'count', id, entries }) });
}
