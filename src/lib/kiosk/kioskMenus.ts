// src/lib/kiosk/kioskMenus.ts
// Satu sumber kebenaran daftar menu kiosk tambahan. Cermin dari erp-epi
// src/lib/config/kioskMenus.js — JANGAN ubah salah satu sisi saja.
//
// File 07, Perbaikan Kiosk × Produksi & Inventory (29 Sep 2026).

export const KIOSK_MENUS = [
	{ key: 'qc', label: 'Input Hasil QC', grup: 'Produksi' },
	{ key: 'konsumsi_bahan', label: 'Cek Kelengkapan Bahan', grup: 'Produksi' },
	{ key: 'fg_receive', label: 'Terima Barang Jadi', grup: 'Gudang' },
	{ key: 'gudang_stok', label: 'Cek Stok & Pindah Rak', grup: 'Gudang' },
	{ key: 'gudang_pick', label: 'Ambil Barang (Picking)', grup: 'Gudang' },
	{ key: 'gudang_opname', label: 'Hitung Stok (Opname)', grup: 'Gudang' },
	{ key: 'gudang_transfer', label: 'Transfer Antar Gudang', grup: 'Gudang' },
	{ key: 'siapkan_sj', label: 'Siapkan SJ (TTD Gudang)', grup: 'Pengiriman' },
	{ key: 'muat_sj', label: 'Muat Barang', grup: 'Pengiriman' },
	{ key: 'papan_sj', label: 'Papan Pantau SJ', grup: 'Pengiriman' },
	{ key: 'gerbang_sj', label: 'Gerbang Satpam', grup: 'Pengiriman' },
	{ key: 'ciketing_potong_bahan', label: 'Potong Bahan Ciketing', grup: 'WS Ciketing' },
	{ key: 'ciketing_cek_stok', label: 'Cek Stok Ciketing', grup: 'WS Ciketing' },
	{ key: 'balaraja_potong_bahan', label: 'Potong Bahan Balaraja', grup: 'WS Balaraja' },
	{ key: 'balaraja_cek_stok', label: 'Cek Stok Balaraja', grup: 'WS Balaraja' }
] as const;

export type KioskMenuKey = (typeof KIOSK_MENUS)[number]['key'];
export const KIOSK_MENU_KEYS: string[] = KIOSK_MENUS.map((m) => m.key);

/** Menu default yang selalu nyala untuk semua akun kiosk (tanpa centang admin). */
export const KIOSK_MENU_DEFAULT = ['input_produksi', 'lapor_mesin', 'absen_istirahat'] as const;
