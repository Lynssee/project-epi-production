import directus, { handleDirectusError } from './directus';
import { readItems } from '@directus/sdk';

export interface Manpower {
	id: number;
	nama: string | null;
	posisi: string | null;
	domisili: string | null;
	NIK: string | number | null; // varchar sejak 16 Sep 2026; jangan dikonversi ke Number (16 digit > MAX_SAFE_INTEGER)
	no_telpon: number | null;
	breakdown: string | null;
	total_jasa: number | null;
	id_reference: string | null;
	nama_kontak_darurat?: string | null;
	kontak_darurat_telp?: string | null;
	ktp?: boolean | null;
	foto_ktp?: string | null;
}

export const MANPOWER_FIELDS = [
	'id', 'nama', 'posisi', 'domisili', 'NIK', 'no_telpon', 'breakdown', 'total_jasa',
	'id_reference', 'nama_kontak_darurat', 'kontak_darurat_telp', 'ktp', 'foto_ktp'
];

/**
 * Get all manpower records
 * Sorted by nama ascending
 *
 * NB: `filterBreakdown` dulu memfilter server-side field `breakdown` (teks bebas
 * nama proyek/pelanggan) dengan label "Borongan/Harian/Bulanan" — filter itu
 * SELALU kosong karena breakdown tidak pernah berisi kata-kata itu (883/975 baris
 * kosong, sisanya nama proyek). Status Harian/Borongan yang benar berasal dari
 * `manpower_assignment.rate_tipe`; parameter ini sengaja tidak lagi memfilter apa
 * pun di sini — pemanggil (admin/manpower) memfilter client-side dari assignment.
 */
export async function getAllManpower(options: { limit?: number; offset?: number; search?: string; sort?: string; filterBreakdown?: string } = {}): Promise<Manpower[]> {
	try {
		const filter: Record<string, any> = {};

		if (options.search) {
			const q = options.search.trim();
			filter._or = [
				{ nama: { _icontains: q } },
				{ posisi: { _icontains: q } },
				{ domisili: { _icontains: q } },
				{ id_reference: { _icontains: q } }
			];
			if (!isNaN(Number(q))) {
				filter._or.push({ NIK: { _eq: String(q) } });
			}
		}

		const queryOptions: any = {
			filter,
			fields: MANPOWER_FIELDS,
			sort: options.sort ? [options.sort] : ['nama'],
			limit: options.limit !== undefined ? options.limit : 1000
		};

		if (options.offset !== undefined) {
			queryOptions.offset = options.offset;
		}

		const result = await directus.request(
			readItems('manpower', queryOptions)
		);
		return (result || []) as Manpower[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/**
 * Get single manpower by ID
 */
export async function getManpowerById(id: number): Promise<Manpower | null> {
	try {
		const result = await directus.request(
			readItems('manpower', {
				fields: MANPOWER_FIELDS,
				filter: { id: { _eq: id } },
				limit: 1
			})
		);
		return (result && result.length > 0) ? result[0] as Manpower : null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/**
 * FASE 6 (Rencana Self-Service PL v2) — cek duplikat NIK lintas proyek sebelum
 * mendaftarkan pekerja baru dari lapangan. NIK disimpan sebagai varchar (string) di koleksi
 * `manpower` (16 digit pas di batas presisi — pemanggil WAJIB memvalidasi 16 digit
 * dari string dulu). Mengembalikan baris yang sudah ada, atau null.
 */
export async function findManpowerByNik(nik: string | number): Promise<Manpower | null> {
	const digits = String(nik).replace(/\D/g, '');
	if (digits.length !== 16) return null;
	try {
		const result = await directus.request(
			readItems('manpower', {
				fields: MANPOWER_FIELDS,
				filter: { NIK: { _eq: digits } }, // string — Number() merusak presisi 16 digit (GPA-06)
				limit: 1
			})
		);
		return result && result.length > 0 ? (result[0] as Manpower) : null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/** Normalisasi nama untuk cek duplikat: huruf kecil, spasi ganda dirapikan. */
export function normalizeNama(nama: string | null | undefined): string {
	return String(nama ?? '').trim().replace(/s+/g, ' ').toLowerCase();
}

/**
 * GPA-10 — cari pekerja yang namanya SAMA (setelah normalisasi huruf besar/kecil & spasi) sebelum
 * mendaftarkan pekerja baru. Nama sama bukan pasti orang sama (mis. "HADI"), jadi hasilnya hanya
 * dipakai untuk peringatan + konfirmasi pengguna, bukan pemblokiran. Gagal baca -> [] (tidak
 * memblokir pendaftaran) tapi dicatat.
 */
export async function findManpowerByNama(
	nama: string
): Promise<Array<{ id: number; nama: string; posisi: string | null; status_pekerja: string | null }>> {
	const norm = normalizeNama(nama);
	if (norm.length < 2) return [];
	try {
		const rows = (await directus.request(
			readItems('manpower', {
				fields: ['id', 'nama', 'posisi', 'status_pekerja'] as any,
				filter: { nama: { _icontains: norm } } as any,
				limit: 30
			})
		)) as any[];
		return (rows || []).filter((r) => normalizeNama(r.nama) === norm);
	} catch (error) {
		console.error('[findManpowerByNama] gagal cek nama kembar:', error);
		return [];
	}
}

/**
 * Get manpower records filtered by a list of IDs
 * Used to show only manpower relevant to a specific leader's projects
 */
export async function getManpowerByIds(ids: number[], options: { limit?: number; offset?: number; search?: string; sort?: string; filterPosisi?: string } = {}): Promise<Manpower[]> {
	if (!ids || ids.length === 0) return [];
	try {
		const filter: Record<string, any> = {
			id: { _in: ids }
		};

		if (options.search) {
			const q = options.search.trim();
			const searchFilter: any = {
				_or: [
					{ nama: { _icontains: q } },
					{ posisi: { _icontains: q } },
					{ domisili: { _icontains: q } },
					{ id_reference: { _icontains: q } }
				]
			};
			if (!isNaN(Number(q))) {
				searchFilter._or.push({ NIK: { _eq: String(q) } });
			}
			filter._and = [searchFilter];
		}

		const queryOptions: any = {
			filter,
			fields: MANPOWER_FIELDS,
			sort: options.sort ? [options.sort] : ['nama'],
			limit: options.limit !== undefined ? options.limit : 1000
		};

		if (options.offset !== undefined) {
			queryOptions.offset = options.offset;
		}

		const result = await directus.request(
			readItems('manpower', queryOptions)
		);
		return (result || []) as Manpower[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/**
 * Create new manpower record
 *
 * Pendaftaran manpower baru dari lapangan otomatis masuk sebagai status_pekerja
 * 'calon' — hanya HRD (tab Tenaga Kerja Lapangan, erp-epi-1) yang bisa
 * memverifikasinya jadi 'terverifikasi'. Ini yang menghentikan pertumbuhan baris
 * manpower tak terkendali (Rencana-Manpower-Management-v2.1, Bagian 6 & 11 Fase 1).
 */
export async function createManpower(data: Partial<Manpower> & Record<string, any>): Promise<Manpower | null> {
	try {
		const { createItem } = await import('@directus/sdk');
		const payload = { status_pekerja: 'calon', ...data };
		const result = await directus.request(createItem('manpower', payload));
		return result as Manpower;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export async function updateManpower(id: number, data: Partial<Manpower> & Record<string, any>): Promise<Manpower | null> {
	try {
		const { updateItem } = await import('@directus/sdk');
		const result = await directus.request(updateItem('manpower', id, data));
		return result as Manpower;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

// ── Dokumen & Kepatuhan (Akuntabilitas Pembayaran Manpower v3, F4.4) ───────────────────────
// Jenis dokumen SAMA PERSIS dgn erp-epi-1 hrdManpowerDokumenApi.js — satu kosakata dua repo.
export const MANPOWER_JENIS_DOKUMEN = [
	{ value: 'ktp', label: 'KTP' },
	{ value: 'sertifikat_k3', label: 'Sertifikat Keselamatan' },
	{ value: 'surat_kesehatan', label: 'Surat Kesehatan' },
	{ value: 'mcu', label: 'Hasil MCU' },
	{ value: 'skck', label: 'SKCK' },
	{ value: 'kontak_darurat', label: 'Kontak Darurat' },
	{ value: 'lainnya', label: 'Lainnya' }
];

/**
 * Unggah dokumen manpower dari lokasi (foto via HP) — masuk antrean verifikasi HRD
 * (status_verifikasi='menunggu'), sama status awal dengan unggahan dari erp-epi-1.
 * File SUDAH diunggah ke Directus oleh pemanggil (fileId) — fungsi ini hanya membuat
 * baris manpower_dokumen, konsisten dgn pola upload-lalu-createItem di GR/stock lapangan.
 */
export async function createManpowerDokumen(params: {
	manpowerId: number;
	jenisDokumen: string;
	fileId: string;
	tanggalKedaluwarsa?: string | null;
	/** Proyek yang dipimpin pemanggil — wajib untuk pekerja yang belum punya SPK (alur pendaftaran). */
	projectId?: number | string | null;
}): Promise<{ id: number }> {
	// GPA-05: tulis lewat endpoint server (token server), bukan token user lapangan. Gagal = THROW
	// (jangan ditelan) supaya pemanggil tidak melaporkan "berhasil" padahal KTP tidak sampai ke HRD.
	// Jaringan putus melempar TypeError (dipakai antrean offline); error server melempar Error biasa.
	const res = await fetch('/api/manpower/dokumen', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			manpowerId: params.manpowerId,
			jenisDokumen: params.jenisDokumen,
			fileId: params.fileId,
			tanggalKedaluwarsa: params.tanggalKedaluwarsa || null,
			projectId: params.projectId != null && params.projectId !== '' ? Number(params.projectId) : null
		})
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok || !data?.id) {
		console.error('[createManpowerDokumen] gagal', res.status, data);
		throw new Error(data?.message || `Dokumen tidak tersimpan (HTTP ${res.status}).`);
	}
	return { id: data.id };
}
