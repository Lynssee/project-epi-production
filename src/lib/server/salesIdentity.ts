// src/lib/server/salesIdentity.ts
// Paket 08b Site Visit Release §4.2 — resolusi identitas sales SELALU dari data karyawan sisi
// server (token Firebase → karyawan), TIDAK PERNAH dari input klien. Sebelumnya
// services/sales.ts:checkInVisit menulis visit_sales langsung dari browser dengan sales_id/
// sales_name yang bisa dipalsukan begitu saja (worst case #8 dokumen).
//
// cleanSalesmanName() adalah SALINAN dari services/sales.ts (bukan dipindah) — versi client
// dipertahankan untuk fungsi-fungsi lain di sana (getSalesRepresentativeOptions dkk) yang di
// luar cakupan Paket 08b. Duplikasi kecil (satu fungsi murni, alias nama) lebih aman daripada
// menyentuh file client yang sangat besar dan dipakai luas.

import type { ServerKaryawan } from '$lib/server/ess/karyawan';

/** Alias nama sales yang salah eja/typo di data historis — pola sama services/sales.ts. */
export function cleanSalesmanName(name?: string | null): string {
	if (!name) return '';
	const n = name.trim();
	const upper = n.toUpperCase();
	if (upper === 'AIE SUYA DILAGA') return 'AIE SURYA DILAGA';
	if (upper === 'ASEP ACHMAD YANUAR W.S') return 'ASEP ACHMAD YANUAR';
	if (upper === 'MOHAMMAD IKHSAN') return 'MOCHAMMAD IKHSAN';
	return n;
}

export interface SalesIdentity {
	salesId: number;
	salesName: string;
}

/** Identitas sales dari karyawan yang SUDAH diverifikasi lewat token Firebase (authenticateEss). */
export function resolveSalesIdentity(karyawan: ServerKaryawan): SalesIdentity {
	return {
		salesId: Number(karyawan.id),
		salesName: cleanSalesmanName(karyawan.nama_karyawan) || `Karyawan #${karyawan.id}`
	};
}
