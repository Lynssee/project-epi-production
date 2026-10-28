// src/lib/services/rndFieldLogs.ts
// Rekomendasi Tambahan lapangan #2 (QR Retained Sample) & #3 (Weathering/Outdoor Exposure Log).
// Pola sama dengan rndField.ts::reportProductIssue — upload foto opsional lalu createItem.
// 2 koleksi baru murni untuk fitur ini (qc_retained_samples, rnd_weathering_logs) — sebelumnya
// data ini tidak ada sama sekali (retensi hanya terisi reaktif via customer_complaints saat
// komplain, weathering tidak terstruktur sama sekali — lihat catatan di kedua tab +page.svelte).

import directus from './directus';
import { readItems, createItem, uploadFiles } from '@directus/sdk';

async function uploadPhoto(file: File | null | undefined): Promise<string | null> {
	if (!file) return null;
	try {
		const formData = new FormData();
		formData.append('file', file);
		const uploaded: any = await directus.request(uploadFiles(formData));
		return uploaded?.id || null;
	} catch (err) {
		console.warn('Gagal unggah foto:', err);
		return null;
	}
}

// ── QR Retained Sample Logging ──────────────────────────────────────────────

export interface RetainedSampleLogInput {
	batchNo: string;
	lokasiSimpan: string;
	expiryDate?: string | null;
	catatan?: string;
	site: string;
	dicatatOleh: string;
	fotoFile?: File | null;
}

export async function logRetainedSample(payload: RetainedSampleLogInput) {
	const fotoId = await uploadPhoto(payload.fotoFile);
	return directus.request(
		createItem('qc_retained_samples', {
			batch_no: payload.batchNo,
			lokasi_simpan: payload.lokasiSimpan,
			tanggal_simpan: new Date().toISOString().slice(0, 10),
			expiry_date: payload.expiryDate || null,
			catatan: payload.catatan || null,
			site: payload.site || 'pusat',
			dicatat_oleh: payload.dicatatOleh,
			foto: fotoId,
			status: 'disimpan'
		})
	);
}

export interface RetainedSampleLogRow {
	id: number;
	batch_no: string;
	lokasi_simpan: string | null;
	tanggal_simpan: string | null;
	expiry_date: string | null;
	status: string;
	site: string | null;
}

/** Riwayat singkat untuk batch yang sama — supaya field tahu kalau batch ini sudah pernah dicatat. */
export async function fetchRetainedSamplesByBatch(batchNo: string): Promise<RetainedSampleLogRow[]> {
	if (!batchNo.trim()) return [];
	return (await directus.request(
		readItems('qc_retained_samples', {
			filter: { batch_no: { _eq: batchNo.trim() } },
			fields: ['id', 'batch_no', 'lokasi_simpan', 'tanggal_simpan', 'expiry_date', 'status', 'site'],
			sort: ['-tanggal_simpan'],
			limit: 5
		})
	)) as unknown as RetainedSampleLogRow[];
}

// ── Weathering / Outdoor Exposure Log ───────────────────────────────────────

export interface WeatheringLogInput {
	namaPanel: string;
	kondisiCuaca: string;
	pengamatan: string;
	site: string;
	dicatatOleh: string;
	fotoFile?: File | null;
}

export async function logWeatheringObservation(payload: WeatheringLogInput) {
	const fotoId = await uploadPhoto(payload.fotoFile);
	return directus.request(
		createItem('rnd_weathering_logs', {
			nama_panel: payload.namaPanel,
			tanggal_observasi: new Date().toISOString().slice(0, 10),
			kondisi_cuaca: payload.kondisiCuaca || null,
			pengamatan: payload.pengamatan,
			site: payload.site || 'pusat',
			dicatat_oleh: payload.dicatatOleh,
			foto: fotoId
		})
	);
}

export interface WeatheringLogRow {
	id: number;
	nama_panel: string;
	tanggal_observasi: string | null;
	kondisi_cuaca: string | null;
	pengamatan: string | null;
}

/** Riwayat observasi panel yang sama — timeline sederhana. */
export async function fetchWeatheringLogsByPanel(namaPanel: string): Promise<WeatheringLogRow[]> {
	if (!namaPanel.trim()) return [];
	return (await directus.request(
		readItems('rnd_weathering_logs', {
			filter: { nama_panel: { _eq: namaPanel.trim() } },
			fields: ['id', 'nama_panel', 'tanggal_observasi', 'kondisi_cuaca', 'pengamatan'],
			sort: ['-tanggal_observasi'],
			limit: 10
		})
	)) as unknown as WeatheringLogRow[];
}
