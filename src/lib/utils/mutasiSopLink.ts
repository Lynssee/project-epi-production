// src/lib/utils/mutasiSopLink.ts
// Tautan "Panduan langkah ini (SOP)" dari kartu e-SJ Mutasi (lapangan) ke Panduan Alur: /panduan/alur?alur=<flow_key>&fokus=<id langkah>.
// MURNI — dites. Cermin erp-epi/src/lib/utils/mutasiSopGuide.js (pemetaan tahap → langkah harus sama; status → tahap mengikuti tahapMutasi()).

export const SOP_MUTASI_FLOW = 'inter_project_material_transfer';

/** Langkah SOP per status dokumen. Status tak dikenal/final-diterima → langkah penerimaan (rekonsiliasi selisih ada di langkah ini). */
const NODE_BY_STATUS: Record<string, string> = {
	diajukan: 'mut_verifikasi_kebutuhan',
	disetujui_tujuan: 'mut_terbit_sj_mutasi',
	dikirim: 'mut_pengiriman_driver',
	lolos_gerbang: 'mut_terima_site_tujuan',
	diterima: 'mut_terima_site_tujuan',
	diterima_sebagian: 'mut_terima_site_tujuan',
	ditolak: 'mut_verifikasi_kebutuhan',
	batal: 'mut_ajukan_transfer'
};

export function sopNodeForStatus(status: string | null | undefined): string {
	return NODE_BY_STATUS[String(status ?? '')] ?? 'mut_terima_site_tujuan';
}

export function sopHrefForStatus(status: string | null | undefined): string {
	return `/panduan/alur?alur=${SOP_MUTASI_FLOW}&fokus=${sopNodeForStatus(status)}`;
}
