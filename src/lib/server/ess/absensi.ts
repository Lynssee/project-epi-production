// src/lib/server/ess/absensi.ts
// Query helper bersama untuk endpoint /api/ess/attendance/* — semua lewat token server.

import { directusServerJson } from '$lib/server/directus';
import { haversineMeters } from '$lib/server/ess/geo';

export interface LokasiAbsensi {
	id: string;
	nama: string;
	lat: number;
	lng: number;
	radius_m: number;
	aktif: boolean;
}

export interface AbsensiHarianRecord {
	id: string;
	karyawan_id: string;
	tanggal: string;
	status: string;
	jam_masuk: string | null;
	jam_keluar: string | null;
	lokasi: string | null;
	foto_selfie: string | null;
	foto_pulang: string | null;
	lat_masuk: number | null;
	lng_masuk: number | null;
	jarak_masuk_m: number | null;
	masuk_valid: boolean | null;
	lat_pulang: number | null;
	lng_pulang: number | null;
	jarak_pulang_m: number | null;
	pulang_valid: boolean | null;
	lokasi_absensi_id: string | null;
	sumber: string | null;
	[key: string]: any;
}

const RECORD_FIELDS = [
	'id',
	'karyawan_id',
	'tanggal',
	'status',
	'jam_masuk',
	'jam_keluar',
	'lokasi',
	'foto_selfie',
	'foto_pulang',
	'lat_masuk',
	'lng_masuk',
	'jarak_masuk_m',
	'masuk_valid',
	'lat_pulang',
	'lng_pulang',
	'jarak_pulang_m',
	'pulang_valid',
	'lokasi_absensi_id',
	'sumber',
	'jam_istirahat_keluar',
	'jam_istirahat_masuk',
	'istirahat_overrun_menit',
	'istirahat_tier',
	'istirahat_jumlah_jeda'
].join(',');

/** Kosong secara logis: belum pernah diisi ('-' dipakai HRD sebagai placeholder). */
export function isEmptyTime(value: string | null | undefined): boolean {
	return !value || value === '-';
}

export async function findTodayRecord(karyawanId: number, tanggal: string): Promise<AbsensiHarianRecord | null> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		'filter[tanggal][_eq]': tanggal,
		fields: RECORD_FIELDS,
		limit: '1'
	});
	const result = await directusServerJson<{ data: AbsensiHarianRecord[] }>(`/items/absensi_harian?${query.toString()}`);
	return result?.data?.[0] || null;
}

/**
 * Riwayat absensi_harian milik satu karyawan pada rentang tanggal (inklusif),
 * terbaru dulu. Dipakai endpoint /api/ess/attendance/riwayat (tab Riwayat + ekspor).
 * `limit` mencegah query berat bila rentang dibiarkan sangat lebar.
 */
export async function listRiwayatAbsensi(
	karyawanId: number,
	opts: { dari?: string; sampai?: string; limit?: number } = {}
): Promise<AbsensiHarianRecord[]> {
	const { dari = '', sampai = '', limit = 400 } = opts;
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		fields: RECORD_FIELDS,
		sort: '-tanggal',
		limit: String(limit)
	});
	if (dari) query.set('filter[tanggal][_gte]', dari);
	if (sampai) query.set('filter[tanggal][_lte]', sampai);
	const result = await directusServerJson<{ data: AbsensiHarianRecord[] }>(
		`/items/absensi_harian?${query.toString()}`
	);
	return result?.data || [];
}

export async function listActiveLokasi(): Promise<LokasiAbsensi[]> {
	const query = new URLSearchParams({
		'filter[aktif][_eq]': 'true',
		fields: 'id,nama,lat,lng,radius_m,aktif'
	});
	const result = await directusServerJson<{ data: LokasiAbsensi[] }>(`/items/lokasi_absensi?${query.toString()}`);
	return result?.data || [];
}

export async function getLokasiById(id: string): Promise<LokasiAbsensi | null> {
	const query = new URLSearchParams({ fields: 'id,nama,lat,lng,radius_m,aktif' });
	try {
		const result = await directusServerJson<{ data: LokasiAbsensi }>(`/items/lokasi_absensi/${id}?${query.toString()}`);
		return result?.data || null;
	} catch {
		return null;
	}
}

/**
 * Titik GPS terakhir karyawan sebelum tanggal ybs (lat/lng + jam sebagai epoch ms Jakarta),
 * dipakai heuristic anti-fake-GPS velocity check (lihat computeAntiFakeGpsScore). Mengambil
 * clock-out lalu fallback clock-in dari record absensi_harian terbaru sebelum tanggal ini.
 */
export async function findLastKnownPoint(
	karyawanId: number,
	beforeTanggal: string
): Promise<{ lat: number; lng: number; atMs: number } | null> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		'filter[tanggal][_lt]': beforeTanggal,
		fields: 'tanggal,jam_masuk,jam_keluar,lat_masuk,lng_masuk,lat_pulang,lng_pulang',
		sort: '-tanggal',
		limit: '1'
	});
	const result = await directusServerJson<{ data: any[] }>(`/items/absensi_harian?${query.toString()}`);
	const row = result?.data?.[0];
	if (!row) return null;

	if (!isEmptyTime(row.jam_keluar) && row.lat_pulang != null && row.lng_pulang != null) {
		return { lat: Number(row.lat_pulang), lng: Number(row.lng_pulang), atMs: Date.parse(`${row.tanggal}T${row.jam_keluar}:00+07:00`) };
	}
	if (!isEmptyTime(row.jam_masuk) && row.lat_masuk != null && row.lng_masuk != null) {
		return { lat: Number(row.lat_masuk), lng: Number(row.lng_masuk), atMs: Date.parse(`${row.tanggal}T${row.jam_masuk}:00+07:00`) };
	}
	return null;
}

/** Pilih lokasi_absensi terdekat dari device — dipakai jika klien tidak memilih lokasi spesifik. */
export function nearestLokasi(lat: number, lng: number, options: LokasiAbsensi[]): LokasiAbsensi | null {
	let best: LokasiAbsensi | null = null;
	let bestDist = Infinity;
	for (const opt of options) {
		const d = haversineMeters(lat, lng, opt.lat, opt.lng);
		if (d != null && d < bestDist) {
			bestDist = d;
			best = opt;
		}
	}
	return best;
}
