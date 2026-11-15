// src/lib/utils/sjBoardLanes.ts
// Lajur papan "Barang Dalam Perjalanan" di /lacak-sj (murni, client-safe). Sumber: track_stage Surat Jalan
// (erp-epi $lib/data/sjStages.js). Tahap selesai (diterima/dokumen_kembali/tutup) sengaja tidak punya lajur.

export interface SjLane {
	key: string;
	label: string;
	hint: string;
	stages: string[];
}

export const SJ_LANES: SjLane[] = [
	{ key: 'siap', label: 'Disiapkan gudang', hint: 'Draft, approval, picking, siap muat', stages: ['draft', 'menunggu_approval', 'disetujui', 'disiapkan', 'siap_muat'] },
	{ key: 'muat', label: 'Dimuat / di gerbang', hint: 'Sudah naik kendaraan, menunggu/lolos pemeriksaan satpam', stages: ['dimuat', 'menunggu_gerbang', 'lolos_gerbang', 'diserahkan_ekspedisi'] },
	{ key: 'jalan', label: 'Dalam perjalanan', hint: 'Barang di jalan menuju lokasi', stages: ['dalam_perjalanan'] },
	{ key: 'tiba', label: 'Tiba — menunggu terima', hint: 'Sudah sampai, belum dikonfirmasi diterima', stages: ['tiba_lokasi'] },
	{ key: 'selisih', label: 'Selisih / komplain', hint: 'Jumlah atau kondisi tidak sesuai', stages: ['selisih'] }
];

/** Kelompokkan SJ per lajur; SJ dengan tahap tak dikenal/selesai tidak masuk papan. */
export function groupSjByLane<T extends { stage?: string | null }>(items: T[] | null | undefined): (SjLane & { rows: T[] })[] {
	const list = Array.isArray(items) ? items : [];
	return SJ_LANES.map((l) => ({ ...l, rows: list.filter((x) => !!x?.stage && l.stages.includes(String(x.stage))) }));
}
