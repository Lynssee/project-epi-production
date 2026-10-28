// src/lib/services/kemitraan.ts
// Modul Kemitraan v2.0 — sisi lapangan (Bab 07). Widget beranda (7.4) & evaluasi
// cepat mingguan (7.3). Skema (master_supplier.mitra_id di manpower, mitra_evaluasi)
// dibuat di sisi admin (erp-epi-1) — di sini murni baca/tulis via Directus yang sama.

import directus, { handleDirectusError } from './directus';
import { readItems, createItem, uploadFiles } from '@directus/sdk';

export async function uploadEvaluasiFoto(file: File, description: string): Promise<string | null> {
	try {
		const formData = new FormData();
		formData.append('file', file);
		formData.append('description', description);
		const result: any = await directus.request(uploadFiles(formData));
		return result?.id || null;
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

export interface MitraOption {
	id: number;
	nama: string;
	tipe_mitra: string | null;
}

export interface MitraDetail {
	id: number;
	kode_supplier?: string | null;
	nama: string;
	tipe_mitra: string | null;
	status: string | null;
	telepon?: string | null;
	email?: string | null;
	alamat?: string | null;
	kontak_person?: string | null;
	skor_total?: number | null;
	skor_terakhir_dihitung?: string | null;
	kategori_bidang?: string | null;
	catatan?: string | null;
}

export const TIPE_MITRA_LABELS: Record<string, { label: string; badge: string }> = {
	subkontraktor: { label: 'Subkontraktor', badge: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800' },
	mandor_borongan: { label: 'Mandor / Borongan', badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800' },
	supplier_material: { label: 'Supplier Material', badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800' },
	vendor_alat: { label: 'Vendor Alat', badge: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-800' },
	konsultan: { label: 'Konsultan', badge: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800' },
	joint_venture: { label: 'Joint Venture', badge: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800' }
};

/** Kolom asli master_supplier: telp, nama_pic, bidang_usaha -> alias yang dipakai UI (telepon, kontak_person, kategori_bidang). */
function normMitra(r: any): any {
	return { ...r, telepon: r.telp ?? null, kontak_person: r.nama_pic ?? null, kategori_bidang: r.bidang_usaha ?? null };
}

export async function fetchMitraOptions(): Promise<MitraOption[]> {
	try {
		return (await directus.request(
			readItems('master_supplier', {
				filter: {
					status: { _eq: 'aktif' },
					is_duplicate_of: { _null: true },
					tipe_mitra: { _in: ['subkontraktor', 'mandor_borongan'] }
				},
				fields: ['id', 'nama', 'tipe_mitra'],
				sort: ['nama'],
				limit: -1
			})
		)) as unknown as MitraOption[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function fetchMitraList(tipeMitra?: string | null): Promise<MitraDetail[]> {
	try {
		const filter: Record<string, any> = {
			status: { _eq: 'aktif' },
			is_duplicate_of: { _null: true }
		};

		if (tipeMitra && tipeMitra !== 'all') {
			filter.tipe_mitra = { _eq: tipeMitra };
		} else {
			filter.tipe_mitra = { _nnull: true };
		}

		return ((await directus.request(
			readItems('master_supplier', {
				filter,
				fields: [
					'id',
					'kode_supplier',
					'nama',
					'tipe_mitra',
					'status',
					'telp',
					'email',
					'alamat',
					'nama_pic',
					'skor_total',
					'skor_terakhir_dihitung',
					'bidang_usaha',
					'catatan'
				],
				sort: ['nama'],
				limit: -1
			})
		)) as unknown as any[]).map(normMitra) as MitraDetail[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

/**
 * Executor Partitioning — Rekomendasi L3 (Section 4.2): Vendor Contact Card. Fetch satu
 * mitra by id untuk kartu popup di Timeline lapangan (klik subtask vendor), supaya leader
 * lihat PIC/telp/email tanpa harus buka ERP.
 */
export async function fetchMitraById(id: number): Promise<MitraDetail | null> {
	try {
		const rows = (await directus.request(
			readItems('master_supplier', {
				filter: { id: { _eq: id } },
				fields: ['id', 'kode_supplier', 'nama', 'tipe_mitra', 'status', 'telp', 'email', 'alamat', 'nama_pic', 'skor_total', 'skor_terakhir_dihitung', 'bidang_usaha', 'catatan'],
				limit: 1
			})
		)) as unknown as MitraDetail[];
		return rows[0] ? normMitra(rows[0]) : null;
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

export interface MitraWidgetSummary {
	pekerjaMitraAktif: number;
	mitraTerlibat: { id: number; nama: string; jumlahPekerja: number }[];
	dokumenPerluPerhatian: number;
}

/** Widget Mitra di Beranda Lapangan (Bab 07.4). */
export async function fetchMitraWidgetSummary(): Promise<MitraWidgetSummary> {
	try {
		const pekerja = (await directus.request(
			readItems('manpower', {
				filter: { mitra_id: { _nnull: true }, status_aktif: { _eq: 'aktif' } },
				fields: ['id', 'mitra_id.id', 'mitra_id.nama'],
				limit: -1
			})
		)) as any[];

		const byMitra = new Map<number, { id: number; nama: string; jumlahPekerja: number }>();
		for (const p of pekerja) {
			const mitraId = p.mitra_id?.id;
			if (!mitraId) continue;
			const existing = byMitra.get(mitraId);
			if (existing) existing.jumlahPekerja++;
			else byMitra.set(mitraId, { id: mitraId, nama: p.mitra_id?.nama || '-', jumlahPekerja: 1 });
		}

		const today = new Date().toISOString().slice(0, 10);
		const h30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
		const docs = (await directus.request(
			readItems('supplier_documents', {
				filter: {
					berlaku_sampai: { _nnull: true, _lte: h30 },
					status_verifikasi: { _neq: 'expired' }
				},
				fields: ['id'],
				limit: -1
			})
		)) as any[];

		return {
			pekerjaMitraAktif: pekerja.length,
			mitraTerlibat: Array.from(byMitra.values()).sort((a, b) => b.jumlahPekerja - a.jumlahPekerja),
			dokumenPerluPerhatian: docs.length
		};
	} catch (err) {
		handleDirectusError(err);
		return { pekerjaMitraAktif: 0, mitraTerlibat: [], dokumenPerluPerhatian: 0 };
	}
}

// ---------------------------------------------------------------------------
// Evaluasi Cepat Mingguan (Bab 07.3) — 5 kriteria bintang, target isi <60 detik.
// ---------------------------------------------------------------------------

export interface EvaluasiCepatPayload {
	mitraId: number;
	projectId?: number | string | null;
	skorKualitas: number;
	skorWaktu: number;
	skorK3: number;
	skorBiaya: number;
	skorKomunikasi: number;
	fotoBuktiId: string;
	evaluator: string;
	catatan?: string;
}

export async function submitEvaluasiCepat(payload: EvaluasiCepatPayload) {
	const nilai = [payload.skorKualitas, payload.skorWaktu, payload.skorK3, payload.skorBiaya, payload.skorKomunikasi];
	const skorTotal = Math.round((nilai.reduce((a, b) => a + b, 0) / nilai.length) * 20 * 10) / 10; // bintang 1-5 -> 0-100

	const now = new Date();
	const periode = `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;

	const saved = await directus.request(
		createItem('mitra_evaluasi', {
			mitra_id: payload.mitraId,
			project_id: payload.projectId || null,
			periode,
			skor_kualitas: payload.skorKualitas * 20,
			skor_waktu: payload.skorWaktu * 20,
			skor_k3: payload.skorK3 * 20,
			skor_biaya: payload.skorBiaya * 20,
			skor_komunikasi: payload.skorKomunikasi * 20,
			skor_total: skorTotal,
			sumber: 'lapangan',
			foto_bukti: [payload.fotoBuktiId],
			evaluator: payload.evaluator,
			catatan: payload.catatan || ''
		})
	);

	// Recompute skor mitra — sama logika dgn kemitraanEvaluasiApi.js sisi admin
	// (Bab 09 gerbang kelayakan data: hanya ditulis bila ada evaluasi asli).
	try {
		const semua = (await directus.request(
			readItems('mitra_evaluasi', {
				filter: { mitra_id: { _eq: payload.mitraId }, skor_total: { _nnull: true } },
				fields: ['skor_total'],
				limit: -1
			})
		)) as any[];
		if (semua.length > 0) {
			const avg = Math.round((semua.reduce((s, r) => s + r.skor_total, 0) / semua.length) * 10) / 10;
			const { updateItem } = await import('@directus/sdk');
			await directus.request(updateItem('master_supplier', payload.mitraId, {
				skor_total: avg,
				skor_terakhir_dihitung: new Date().toISOString()
			}));
		}
	} catch (err) {
		console.warn('Gagal recompute skor mitra (non-fatal):', err);
	}

	return saved;
}
