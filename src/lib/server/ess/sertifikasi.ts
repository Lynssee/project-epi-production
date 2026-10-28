// src/lib/server/ess/sertifikasi.ts
// Fase 2 (Rencana Automasi HR Lifecycle v2) — ESS lapangan untuk karyawan_sertifikasi (koleksi
// sama dipakai HRD di erp-epi-1). Karyawan bisa tambah/perpanjang sertifikasi sendiri (SIM/K3/
// MCU/dll) — file diunggah langsung ke Directus /files, uuid-nya disimpan di file_id (string
// biasa, bukan relasi m2o, mengikuti skema existing).

import { directusServerJson, directusServerUpload } from '$lib/server/directus';

export interface SertifikasiRecord {
	id: number;
	karyawan_id: number;
	nama_sertifikasi: string;
	penerbit: string | null;
	tanggal_terbit: string | null;
	tanggal_expired: string | null;
	file_id: string | null;
	catatan: string | null;
}

const FIELDS = 'id,karyawan_id,nama_sertifikasi,penerbit,tanggal_terbit,tanggal_expired,file_id,catatan';

function unwrapId(value: any): number | null {
	if (value == null) return null;
	return typeof value === 'object' ? (value.id ?? null) : value;
}

function hariMenujuExpired(tanggalExpired: string | null): number | null {
	if (!tanggalExpired) return null;
	const diff = new Date(`${tanggalExpired}T00:00:00`).getTime() - Date.now();
	return Math.round(diff / (24 * 60 * 60 * 1000));
}

export async function listMySertifikasi(karyawanId: number) {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		fields: FIELDS,
		sort: 'tanggal_expired',
		limit: '200'
	});
	const result = await directusServerJson<{ data: SertifikasiRecord[] }>(`/items/karyawan_sertifikasi?${query.toString()}`);
	const rows = (result?.data || []).map((r) => ({ ...r, karyawan_id: unwrapId(r.karyawan_id) as number }));
	return rows.map((r) => {
		const hariLagi = hariMenujuExpired(r.tanggal_expired);
		const urgensi = hariLagi == null ? 'aman' : hariLagi < 0 ? 'kedaluwarsa' : hariLagi <= 30 ? 'segera' : hariLagi <= 90 ? 'perhatian' : 'aman';
		return { ...r, hariLagi, urgensi };
	});
}

async function uploadFile(file: File): Promise<string> {
	const formData = new FormData();
	formData.append('file', file);
	const res = await directusServerUpload(formData);
	if (!res.ok) throw new Error(`Gagal upload file (${res.status})`);
	const body = await res.json();
	const fileId = body?.data?.id;
	if (!fileId) throw new Error('Upload berhasil tapi file id tidak ditemukan.');
	return fileId;
}

/** Tambah sertifikasi baru ATAU perpanjang (kalau existingId diisi) — selalu milik karyawanId ybs. */
export async function saveMySertifikasi(
	karyawanId: number,
	payload: { id?: number; nama_sertifikasi: string; penerbit?: string; tanggal_terbit?: string; tanggal_expired?: string; catatan?: string },
	file: File | null
): Promise<SertifikasiRecord> {
	if (payload.id) {
		const existingRes = await directusServerJson<{ data: SertifikasiRecord }>(`/items/karyawan_sertifikasi/${payload.id}?fields=${FIELDS}`).catch(() => null);
		const existing = existingRes?.data;
		if (!existing || unwrapId(existing.karyawan_id) !== karyawanId) {
			throw new Error('Sertifikasi tidak ditemukan atau bukan milik Anda.');
		}
	}

	let fileId: string | null = null;
	if (file) fileId = await uploadFile(file);

	const body: Record<string, any> = {
		karyawan_id: karyawanId,
		nama_sertifikasi: payload.nama_sertifikasi,
		penerbit: payload.penerbit || null,
		tanggal_terbit: payload.tanggal_terbit || null,
		tanggal_expired: payload.tanggal_expired || null,
		catatan: payload.catatan || null
	};
	if (fileId) body.file_id = fileId;

	const method = payload.id ? 'PATCH' : 'POST';
	const url = payload.id ? `/items/karyawan_sertifikasi/${payload.id}` : '/items/karyawan_sertifikasi';
	const result = await directusServerJson<{ data: SertifikasiRecord }>(url, { method, body: JSON.stringify(body) });
	return result?.data as SertifikasiRecord;
}
