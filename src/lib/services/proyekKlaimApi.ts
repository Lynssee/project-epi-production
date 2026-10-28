// src/lib/services/proyekKlaimApi.ts
// Service untuk data klaim lapangan, backcharge pemborong, dan pekerjaan tambah (project-epi).

import { secureDirectusFetch } from './secureDirectus';

export interface BackchargeTarifItem {
	label: string;
	satuan: string;
	tarif: number;
	keterangan: string;
}

export interface ProyekKlaimRecord {
	id?: number;
	nomor_klaim?: string;
	project_id: number;
	tanggal: string;
	tipe_klaim: 'backcharge_pemborong' | 'pekerjaan_tambah_owner' | 'non_budget_darurat';
	pemborong_id?: number | null;
	nama_pemborong?: string;
	kategori_jasa: string;
	satuan_hitung: 'ritase' | 'jam' | 'ls_nominal';
	volume: number;
	tarif_satuan: number;
	total_nominal: number;
	catatan?: string;
	foto_bukti?: string;
	foto_ba_mandor?: string;
	ttd_digital?: string;
	nama_mandor_penyetuju?: string;
	status?: 'draft' | 'submitted' | 'approved' | 'settled' | 'rejected';
	spk_termin_id?: number | null;
	karyawan_id?: number;
	date_created?: string;
}

let _tarifsCache: Record<string, BackchargeTarifItem> | null = null;
let _tarifsCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Ambil master tarif standar backcharge dari app_settings
 */
export async function getBackchargeTarifs(): Promise<Record<string, BackchargeTarifItem>> {
	const now = Date.now();
	if (_tarifsCache && now - _tarifsCacheTime < CACHE_TTL_MS) {
		return _tarifsCache;
	}

	try {
		const res = await secureDirectusFetch(
			'/items/app_settings?filter[module][_eq]=project&filter[setting_key][_eq]=backcharge_tarifs&fields=setting_value&limit=1'
		);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const body = await res.json();
		const raw = body?.data?.[0]?.setting_value;
		const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

		_tarifsCache = parsed || {};
		_tarifsCacheTime = now;
		return _tarifsCache!;
	} catch (err) {
		console.warn('[proyekKlaimApi] Fallback default backcharge tarifs:', err);
		return {
			buang_puing: { label: 'Jasa Buang Puing Lapangan', satuan: 'ritase', tarif: 350000, keterangan: 'Armada dump truck / ritase' },
			sewa_alat_internal: { label: 'Pemakaian Genset / Kompresor', satuan: 'jam', tarif: 75000, keterangan: 'Per hour meter (HM)' },
			solar_energi: { label: 'BBM Solar Mesin / Genset', satuan: 'liter', tarif: 15000, keterangan: 'Per liter' },
			tenaga_kerja: { label: 'Bantuan Manpower / Helper Ekstra', satuan: 'hari', tarif: 150000, keterangan: 'Per orang per hari' },
			material_talangan: { label: 'Material Talangan Site', satuan: 'ls_nominal', tarif: 0, keterangan: 'Sesuai nota / struk fisik' }
		};
	}
}

/**
 * Ambil daftar klaim yang pernah diajukan untuk proyek tertentu
 */
export async function fetchProjectKlaimList(projectId: number): Promise<ProyekKlaimRecord[]> {
	try {
		const res = await secureDirectusFetch(
			`/items/proyek_klaim_lapangan?filter[project_id][_eq]=${projectId}&sort=-id&limit=50&fields=id,nomor_klaim,tanggal,tipe_klaim,nama_pemborong,kategori_jasa,satuan_hitung,volume,tarif_satuan,total_nominal,catatan,foto_bukti,foto_ba_mandor,nama_mandor_penyetuju,status,date_created`
		);
		if (!res.ok) return [];
		const body = await res.json();
		return Array.isArray(body?.data) ? body.data : [];
	} catch {
		return [];
	}
}
