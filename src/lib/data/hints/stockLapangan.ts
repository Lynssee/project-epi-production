import type { HintModule } from './getHint';

// Ditulis 12 Agustus 2026 dengan memeriksa kode halaman lebih dulu:
//   src/routes/(app)/stock-lapangan/+page.svelte        (menu utama)
//   src/routes/(app)/stock-lapangan/masuk/+page.svelte  (barang masuk / konfirmasi SJ)
//   src/routes/(app)/stock-lapangan/opname/+page.svelte (opname harian)
//
// CATATAN TEMUAN (bukan pekerjaan hint): di masuk/+page.svelte tipe TypeScript kondisi
// barang ditulis 'ok' | 'rusak' | 'hilang', tapi <option> yang benar-benar tampil adalah
// ok | kurang | rusak. Jadi 'hilang' tak bisa dipilih dan 'kurang' di luar tipe.
// Teks hint di bawah mengikuti UI NYATA (Sesuai/Kurang/Rusak), bukan tipenya.

export const stockLapanganHints: HintModule = {
	// ---------- Menu utama ----------
	'menu.page': {
		sectionGuide: {
			title: 'Panduan: Stock Lapangan',
			steps: [
				'Barang Masuk: konfirmasi Surat Jalan yang datang, atau catat penerimaan manual',
				'Hasil Produksi: catat finish good yang selesai dibuat hari ini',
				'Opname Harian: hitung stok fisik lalu bandingkan dengan catatan sistem',
				'Komplain Barang: lapor mutu jelek atau salah kirim SETELAH barang diterima',
				'Tombol QR di kanan atas untuk memindai label barang langsung'
			]
		}
	},

	// ---------- Barang masuk ----------
	'masuk.page': {
		sectionGuide: {
			title: 'Panduan: Barang Masuk',
			steps: [
				'Pilih Surat Jalan yang menunggu konfirmasi, atau cari barang manual bila tanpa SJ',
				'Isi jumlah yang BENAR-BENAR diterima, bukan jumlah yang tertulis di surat',
				'Tandai kondisi tiap barang: Sesuai, Kurang, atau Rusak',
				'Unggah foto bukti serah-terima — tanpa ini penerimaan tidak bisa disimpan',
				'Tanda tangan penerima dan driver sifatnya opsional'
			]
		}
	},
	// Kolom <option> nyata: Sesuai | Kurang | Rusak.
	'masuk.form.kondisi': {
		fieldHint: 'Sesuai = jumlah & mutu cocok. Kurang = jumlah kurang dari surat jalan. Rusak = barang datang dalam keadaan rusak.',
		helpIcon: 'Pilih apa adanya. Menandai "Sesuai" padahal kurang akan membuat stok sistem lebih besar dari fisik, dan selisihnya baru ketahuan saat opname.'
	},
	// Bila qty diterima < qtySent, halaman langsung menampilkan peringatan selisih dan
	// sistem membuatkan klaim otomatis — perilaku ini layak disebut supaya operator tidak
	// takut mengisi angka apa adanya.
	'masuk.form.jumlahDiterima': {
		fieldHint: 'Isi jumlah fisik yang benar-benar Anda hitung saat barang turun — bukan menyalin angka di surat jalan.',
		type: 'warning',
		helpIcon: 'Kalau jumlahnya kurang dari yang dikirim, sistem otomatis membuatkan klaim selisih. Jadi isi apa adanya, tidak perlu dibulatkan agar cocok.'
	},
	// Submit melempar error bila fotoTerimaFileId kosong.
	'masuk.form.fotoBukti': {
		fieldHint: 'Wajib. Penerimaan tidak bisa disimpan tanpa foto bukti serah-terima.',
		type: 'warning'
	},
	'masuk.form.lot': {
		fieldHint: 'Nomor lot/batch dari kemasan. Dipakai menelusuri asal barang bila nanti ada masalah mutu.'
	},
	'masuk.form.kadaluarsa': {
		fieldHint: 'Opsional, tapi isi bila kemasan mencantumkannya — dipakai untuk peringatan barang mendekati kedaluwarsa.'
	},
	'masuk.empty': {
		message: 'Tidak ada Surat Jalan yang menunggu konfirmasi',
		hints: [
			'Surat Jalan muncul di sini setelah gudang pengirim menerbitkannya',
			'Bila barang sudah datang tapi SJ belum muncul, pakai pencarian barang manual di bawah'
		]
	},

	// ---------- Opname ----------
	'opname.page': {
		sectionGuide: {
			title: 'Panduan: Opname Harian',
			steps: [
				'Pindai atau cari barang yang akan dihitung',
				'Hitung fisik di lokasi, lalu isi angkanya — jangan menyalin angka stok sistem',
				'Unggah foto bukti hitungan; foto wajib ada sebelum opname bisa disimpan',
				'Bila hasilnya berbeda dari stok sistem, opname masuk antrean approval admin'
			]
		}
	},
	'opname.form.hitunganFisik': {
		fieldHint: 'Angka hasil hitung fisik Anda di lokasi. Stok sistem ditampilkan hanya sebagai pembanding — jangan disalin.',
		type: 'warning',
		helpIcon: 'Kalau angkanya sama dengan stok sistem, opname langsung selesai tanpa approval. Kalau berbeda, selisihnya perlu disetujui admin dulu.'
	},
	'opname.form.fotoBukti': {
		fieldHint: 'Wajib. Foto tumpukan/rak yang Anda hitung sebagai bukti pendukung selisih.',
		type: 'warning'
	},
	'opname.form.catatan': {
		fieldHint: 'Opsional. Jelaskan penyebab selisih bila ada — sangat membantu admin saat menyetujui.'
	},
	'opname.status.menungguApproval': {
		explain: 'Hasil hitungan Anda berbeda dari stok sistem, jadi penyesuaian stok belum diterapkan. Admin perlu menyetujui selisihnya lebih dulu.'
	}
};
