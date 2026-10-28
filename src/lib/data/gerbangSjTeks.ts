// src/lib/data/gerbangSjTeks.ts
// GSP-08 §4.1 — SATU berkas teks & label untuk form Gerbang SJ (kiosk + app HP). ERP menyalin isinya ke
// erp-epi/src/lib/data/gerbangSjTeks.js ("salinan — sinkronkan dengan project-epi").
// Teks aturan/blocker datang dari server (`pesan`); layar JANGAN mengarang teks sendiri.

export const KATEGORI_TAHAN_LABEL: Record<string, string> = {
	koli: 'Koli',
	plat: 'Plat',
	driver: 'Driver',
	item: 'Barang',
	dokumen: 'Dokumen',
	lainnya: 'Lainnya'
};

export const TEKS = {
	judulAntrian: 'Menunggu di Gerbang',
	judulPenjualan: 'Pengiriman Penjualan Hari Ini',
	hintBelumMuat: 'Gudang belum memindai muat. Periksa barang di kendaraan sesuai daftar, foto muatan, lalu Loloskan.',
	labelBelumMuat: 'Belum discan muat',
	hintPenjualan: 'SJ penjualan sudah tercatat terkirim di sistem. Di sini Anda hanya mencatat bahwa truknya lewat gerbang: cocokkan plat, driver, dan barang dengan SJ kertas, lalu tekan Catat Lolos. Kalau ada yang tidak cocok, jangan dicatat — hubungi Admin Logistik.',
	panduanJudul: 'Cara memeriksa Surat Jalan',
	panduanLangkah: [
		'Scan QR SJ atau pilih dari daftar "Menunggu di Gerbang".',
		'Cocokkan plat, driver, jumlah koli, dan setiap barang dengan kendaraan di depan Anda.',
		'Tekan Loloskan bila semua sesuai, atau Tahan bila ada yang beda. Gudang otomatis diberi tahu.'
	],
	platSesuai: 'Plat sesuai',
	driverSesuai: 'Driver sesuai',
	koliSesuai: 'Jumlah koli sesuai',
	barangAda: 'Ada',
	barangTidakSesuai: 'Tidak sesuai',
	catatanSelisihWajib: 'Tulis catatan selisih (wajib)',
	fotoLabel: 'Foto muatan (opsional)',
	konfirmasiLoloskan: (nomor: string) => `Loloskan SJ ${nomor}? Barang boleh keluar.`,
	efekGagal: 'Catatan: sebagian pencatatan (notifikasi/log) gagal. Beri tahu gudang secara lisan.',
	tidakTerhubung: 'Tidak bisa menghubungi server. Periksa sinyal lalu coba lagi. Data belum tersimpan.'
} as const;

/** Kalimat "Belum: plat, 2 barang." untuk teks bantuan tombol Loloskan yang nonaktif. */
export function kurangText(k: { plat: boolean; driver: boolean; koli: boolean; barang: number }): string {
	const bag: string[] = [];
	if (k.plat) bag.push('plat');
	if (k.driver) bag.push('driver');
	if (k.koli) bag.push('koli');
	if (k.barang > 0) bag.push(`${k.barang} barang`);
	return bag.length ? `Belum: ${bag.join(', ')}.` : '';
}

export function menitText(m: number | null | undefined): string {
	if (m == null) return 'menunggu';
	if (m < 60) return `menunggu ${m} mnt`;
	return `menunggu ${Math.floor(m / 60)} jam ${m % 60} mnt`;
}
