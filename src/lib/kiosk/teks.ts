// src/lib/kiosk/teks.ts
// File 11 §3 (29 Sep 2026) — kumpulan istilah bahasa sehari-hari untuk UI kiosk. Operator
// awam tidak terbiasa dengan istilah teknis (Reject/Waste/Yield/Opname/dst) — field DATABASE
// TIDAK diubah, hanya label yang tampil ke operator. Penggantian istilah berikutnya cukup
// di sini, jangan sebar string baru langsung di halaman.

export const TEKS_PRODUKSI = {
	labelOutput: 'Barang Jadi (bagus) *',
	labelReject: 'Barang Rusak / Cacat',
	labelWaste: 'Terbuang / Tumpah',
	labelTotalBahan: 'Total semua (bagus + rusak + terbuang):',
	labelYield: 'Persentase barang bagus:',
	tombolBatchTuntas: 'Sudah selesai semua'
} as const;

export const TEKS_GUDANG = {
	tagAntrian: 'Ambil Barang',
	labelAntrian: 'Ambil Barang untuk Permintaan',
	judulAntrian: 'Ambil Barang untuk Permintaan',
	labelOpname: 'Hitung Stok Rak',
	judulOpname: 'Hitung Stok Rak',
	modulBelumAktif: 'Menu ini belum dibuka oleh admin. Tanya supervisor.'
} as const;

export const TEKS_FG = {
	judulHalaman: 'Terima Barang Jadi',
	labelBeranda: 'Terima Barang Jadi',
	descBeranda: 'Konfirmasi barang jadi yang diterima dari produksi ke gudang'
} as const;

export const TEKS_QC = {
	descBeranda: 'Isi hasil ukur & foto alat ukur',
	labelBeranda: 'Catat Hasil Uji Kualitas'
} as const;

export const TEKS_KONSUMSI = {
	labelBeranda: 'Cek Kelengkapan Bahan',
	descBeranda: 'Centang bahan yang sudah ada di lini. Tidak mengubah stok.'
} as const;

export const TEKS_SESI = {
	offline: 'Tidak ada sinyal — tunggu sebentar'
} as const;
