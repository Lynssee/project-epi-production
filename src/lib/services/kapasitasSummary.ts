// src/lib/services/kapasitasSummary.ts
// Kapasitas Proyek & Rekomendasi Dashboard v2 — Fase 4 poin 1. Baca LANGSUNG koleksi
// `kapasitas_snapshots` (ditulis cron kapasitas-snapshot di erp-epi-1) — TIDAK memanggil
// endpoint erp-epi-1 lintas-origin, konsisten dengan pola commandCenter.ts (SATU Directus
// yang sama dipakai kedua app). Company-wide, BUKAN per-departemen — beda dari
// getFieldCommandCenterSnapshot() yang di-scope karyawan.divisi.

import { secureDirectusJson } from './secureDirectus';

export interface KapasitasSummary {
	generated_at: string;
	layak_dipercaya: boolean;
	alasan: string[];
	skor_overall: number | null;
	skor_label: string;
	manpower_tersedia: number | null;
	manpower_bertugas: number | null;
	manpower_bentrok: number;
	material_item_kritis: number | null;
	cashflow_lampu: 'hijau' | 'kuning' | 'merah' | 'abu';
	equipment_catatan: string | null;
}

const LAMPU_FROM_SKOR = (skor: number | null): KapasitasSummary['cashflow_lampu'] => {
	if (skor == null) return 'abu';
	if (skor >= 70) return 'hijau';
	if (skor >= 40) return 'kuning';
	return 'merah';
};

/**
 * Ambil snapshot kapasitas terbaru. Return null bila belum pernah ada snapshot
 * (cron kapasitas-snapshot di erp-epi-1 masih nonaktif / belum pernah dijalankan) —
 * halaman WAJIB menampilkan pesan jujur untuk kasus ini, bukan angka kosong yang
 * terlihat seperti data valid.
 */
export async function getKapasitasSummary(): Promise<KapasitasSummary | null> {
	try {
		const res = await secureDirectusJson<{ data: any[] }>(
			`/items/kapasitas_snapshots?sort=-created_at&limit=1&fields=created_at,skor_overall,ringkasan,data_quality`
		);
		const row = res?.data?.[0];
		if (!row) return null;

		const ringkasan = row.ringkasan || {};
		const dq = row.data_quality || ringkasan.data_quality || {};
		const manpower = ringkasan.manpower || {};
		const material = ringkasan.material || {};
		const cashflowSkor = ringkasan.cashflow?.skor ?? null;
		const equipment = ringkasan.equipment || {};

		return {
			generated_at: row.created_at,
			layak_dipercaya: !!dq.layak_dipercaya,
			alasan: dq.alasan || [],
			skor_overall: row.skor_overall,
			skor_label: ringkasan.capacity_score?.label || '-',
			manpower_tersedia: manpower.tersedia ?? null,
			manpower_bertugas: manpower.bertugas ?? null,
			manpower_bentrok: Array.isArray(manpower.bentrok) ? manpower.bentrok.length : 0,
			material_item_kritis: material.item_kritis_count ?? null,
			cashflow_lampu: LAMPU_FROM_SKOR(cashflowSkor),
			equipment_catatan: equipment.skor == null ? equipment._alasan || null : null
		};
	} catch (error) {
		console.error('getKapasitasSummary:', error);
		return null;
	}
}
