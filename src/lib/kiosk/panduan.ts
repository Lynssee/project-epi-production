// src/lib/kiosk/panduan.ts
// File 11 §6 (29 Sep 2026) — isi panduan default per halaman kiosk (tombol "?"). Dokumen
// menyebut isi IDEALNYA diambil dari editor panduan Super Admin di erp-epi; itu belum ada
// integrasinya di sini, jadi ini dipakai sebagai fallback tetap sesuai anjuran dokumen
// ("Kalau belum ada, gunakan teks default di teks.ts"). Maksimal 3 langkah per halaman.

export interface LangkahPanduan {
	icon: string;
	teks: string;
}

export interface PanduanHalaman {
	judul: string;
	langkah: LangkahPanduan[];
}

const PANDUAN: Record<string, PanduanHalaman> = {
	'/kiosk': {
		judul: 'Cara Login',
		langkah: [
			{ icon: '🪪', teks: 'Tempelkan kartu badge Anda ke alat scan, atau ketik nomor karyawan.' },
			{ icon: '🔢', teks: 'Ketuk kotak PIN, lalu isi 6 angka PIN Anda.' },
			{ icon: '✅', teks: 'Tekan Masuk.' }
		]
	},
	'/kiosk/home': {
		judul: 'Cara Pakai Beranda',
		langkah: [
			{ icon: '🟩', teks: 'Pilih menu sesuai pekerjaan Anda sekarang.' },
			{ icon: '📋', teks: 'Angka di setiap menu menunjukkan pekerjaan yang menunggu.' }
		]
	},
	'/kiosk/input-produksi': {
		judul: 'Cara Input Produksi',
		langkah: [
			{ icon: '🟩', teks: 'Pilih pekerjaan (SPK) yang sedang Anda kerjakan.' },
			{ icon: '🔢', teks: 'Ketuk kotak angka, isi jumlah barang bagus, rusak, dan terbuang.' },
			{ icon: '✅', teks: 'Tekan SIMPAN. Kalau SPK sudah selesai semua, centang dulu "Sudah selesai semua".' }
		]
	},
	'/kiosk/gudang/opname': {
		judul: 'Cara Hitung Stok Rak',
		langkah: [
			{ icon: '📍', teks: 'Scan atau pilih rak yang mau dihitung.' },
			{ icon: '🔢', teks: 'Hitung barang fisiknya, lalu ketuk kotak angka untuk mengisi.' },
			{ icon: '✅', teks: 'Tekan Simpan. Kalau angkanya beda jauh, akan ditinjau supervisor dulu.' }
		]
	},
	'/kiosk/gudang/antrian': {
		judul: 'Cara Ambil Barang untuk Permintaan',
		langkah: [
			{ icon: '📋', teks: 'Pilih permintaan yang mau disiapkan.' },
			{ icon: '📦', teks: 'Ambil barang sesuai daftar, lalu ketuk untuk mencatat jumlahnya.' },
			{ icon: '✅', teks: 'Tekan Simpan setiap kali selesai satu barang.' }
		]
	},
	'/kiosk/qc': {
		judul: 'Cara Catat Hasil Uji Kualitas',
		langkah: [
			{ icon: '🧪', teks: 'Pilih SPK yang mau diuji.' },
			{ icon: '📷', teks: 'Isi hasil ukur tiap parameter, foto alat ukurnya.' },
			{ icon: '✅', teks: 'Tekan Simpan Hasil Uji.' }
		]
	},
	'/kiosk/fg-terima': {
		judul: 'Cara Terima Barang Jadi',
		langkah: [
			{ icon: '🟩', teks: 'Pilih SPK yang barangnya sudah datang.' },
			{ icon: '⚖️', teks: 'Hitung fisik barang yang Anda terima, isi di kotak angka.' },
			{ icon: '✅', teks: 'Tekan Simpan.' }
		]
	},
	'/kiosk/konsumsi': {
		judul: 'Cara Cek Kelengkapan Bahan',
		langkah: [
			{ icon: '🟩', teks: 'Pilih SPK yang sedang Anda kerjakan.' },
			{ icon: '☑️', teks: 'Centang bahan yang sudah ada di lini. Ini hanya pengingat, tidak mengubah stok.' },
			{ icon: '⚠️', teks: 'Kalau ada bahan kurang atau sisa, pakai tombol Bahan Kurang / Ada Sisa di baris bahannya.' }
		]
	}
};

const DEFAULT_PANDUAN: PanduanHalaman = {
	judul: 'Panduan',
	langkah: [{ icon: 'ℹ️', teks: 'Belum ada panduan khusus untuk halaman ini. Hubungi supervisor bila bingung.' }]
};

/** Cocokkan path kiosk saat ini ke kunci panduan. Path dengan segmen dinamis (mis. rak/[id])
 *  jatuh ke prefix terdekat yang terdaftar, supaya tidak perlu mendaftar tiap variasi URL. */
export function getPanduan(pathname: string): PanduanHalaman {
	if (PANDUAN[pathname]) return PANDUAN[pathname];
	const prefixMatch = Object.keys(PANDUAN)
		.filter((k) => k !== '/kiosk' && pathname.startsWith(k))
		.sort((a, b) => b.length - a.length)[0];
	return prefixMatch ? PANDUAN[prefixMatch] : DEFAULT_PANDUAN;
}
