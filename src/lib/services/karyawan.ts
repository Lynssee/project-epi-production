import directus, { handleDirectusError } from './directus';
import { readItems } from '@directus/sdk';

export interface Karyawan {
	id: number;
	nama_karyawan: string;
	email_company: string;
	divisi: string;
	no_hp: string;
	status: string;
	id_karyawan: string;
	// posisi adalah FK ke collection posisi (relasi M2O), Directus mengembalikan ID numerik saat tidak di-expand
	posisi: string | number | null;
}

/**
 * Get karyawan by company email (email_company field) or system email.
 * Jika ada duplikat record (misal: 2 ID karyawan untuk 1 email), pilih yang punya posisi terisi.
 * Jika ada karyawanIdHint (dari Firestore user), gunakan itu sebagai tiebreaker.
 */
export async function getKaryawanByEmail(email: string, karyawanIdHint?: string | number | null): Promise<Karyawan | null> {
	try {
		const result = await directus.request(
			readItems('karyawan', {
				filter: {
					email_company: { _eq: email.toLowerCase() }
				},
				fields: ['id', 'nama_karyawan', 'email_company', 'divisi', 'no_hp', 'status', 'id_karyawan', 'posisi'],
				// Ambil semua (bukan limit:1) untuk handle kasus duplikat karyawan
				limit: 10,
				sort: ['-id'] // ID terbesar dulu (record terbaru)
			})
		);

		if (!result || result.length === 0) return null;

		const records = result as Karyawan[];

		// Jika hanya 1 record, langsung return
		if (records.length === 1) return records[0];

		// Jika ada hint karyawanId dari Firestore, prioritaskan record itu
		if (karyawanIdHint != null) {
			const hintIdStr = String(karyawanIdHint);
			const matchByHint = records.find(r => String(r.id) === hintIdStr);
			if (matchByHint) return matchByHint;
		}

		// Dari semua duplikat: pilih yang punya posisi terisi terlebih dahulu
		const withPosisi = records.find(r => r.posisi != null && r.posisi !== '');
		if (withPosisi) return withPosisi;

		// Fallback ke record pertama (ID terbesar)
		return records[0];
	} catch (error) {
		console.warn('[karyawan] Gagal mengambil karyawan by email:', error);
		return null;
	}
}

/**
 * Get karyawan by nama_karyawan (exact match)
 */
export async function getKaryawanByName(name: string): Promise<Karyawan | null> {
	try {
		const result = await directus.request(
			readItems('karyawan', {
				filter: { nama_karyawan: { _eq: name } },
				fields: ['id', 'nama_karyawan', 'email', 'email_company', 'divisi', 'no_hp', 'status'],
				limit: 1
			})
		);
		return (result && result.length > 0) ? result[0] as Karyawan : null;
	} catch (error) {
		console.warn('[karyawan] Gagal mengambil karyawan by name:', error);
		return null;
	}
}

/**
 * Get all karyawan (for admin)
 */
export async function getAllKaryawan(): Promise<Karyawan[]> {
	try {
		const result = await directus.request(
			readItems('karyawan', {
				fields: ['id', 'nama_karyawan', 'email', 'email_company', 'divisi', 'no_hp', 'status', 'posisi'],
				sort: ['nama_karyawan'],
				limit: 500
			})
		);
		return (result || []) as Karyawan[];
	} catch (error) {
		console.warn('[karyawan] Gagal mengambil list karyawan:', error);
		return [];
	}
}
