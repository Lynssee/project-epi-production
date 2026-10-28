import type { HintModule } from './getHint';

// Ditulis 12 Agustus 2026 dengan memeriksa kode halaman lebih dulu:
//   src/routes/(app)/ess/+page.svelte           (dashboard karyawan)
//   src/routes/(app)/ess/cuti/baru/+page.svelte (ajukan cuti)
//   src/routes/(app)/ess/lembur/baru/+page.svelte
//   src/routes/(app)/ess/kasbon/baru/+page.svelte
//
// Aturan yang disebut di bawah diambil dari `canSubmit` masing-masing form, bukan asumsi.

export const essHints: HintModule = {
	// ---------- Dashboard ----------
	'menu.page': {
		sectionGuide: {
			title: 'Panduan: Portal Karyawan',
			steps: [
				'Kehadiran: ajukan izin/sakit, cuti, dan lembur — semuanya perlu persetujuan atasan',
				'Keuangan: ajukan kasbon atau reimbursement, dan lihat slip gaji Anda',
				'Dokumen: tanda tangani dokumen yang menunggu, atau minta surat keterangan',
				'Angka merah kecil di menu berarti ada yang menunggu tindakan Anda'
			]
		}
	},

	// ---------- Aset & Alat Saya ----------
	'aset-saya.page': {
		sectionGuide: {
			title: 'Panduan: Aset & Alat Saya',
			steps: [
				'Halaman ini menampilkan barang kantor yang tercatat atas nama Anda: laptop/HP IT tetap, unit pinjaman IT sementara, aset fasilitas/GA, dan alat kerja lapangan yang sedang dipinjam.',
				'Kalau ada barang yang rusak atau bermasalah, tekan tombol "Lapor Kerusakan" pada kartu barangnya — laporan langsung terisi otomatis dan masuk ke tim terkait (IT/GA/Maintenance).',
				'Untuk pengembalian atau serah terima barang, tetap lewat prosedur modul terkait (IT/GA) — halaman ini murni tampilan ringkasan untuk Anda.'
			]
		}
	},

	// ---------- Cuti ----------
	'cuti.page': {
		sectionGuide: {
			title: 'Panduan: Ajukan Cuti',
			steps: [
				'Pilih jenis cuti yang sesuai — jenisnya menentukan jatah mana yang dipakai',
				'Tentukan tanggal mulai dan selesai; Sabtu dan Minggu tidak dihitung',
				'Periksa "Jumlah Hari" yang muncul otomatis sebelum mengirim',
				'Alasan boleh dikosongkan, tapi sangat membantu proses persetujuan'
			]
		}
	},
	// JENIS_CUTI_OPTIONS: Cuti Tahunan | Cuti Sakit | Cuti Melahirkan | Cuti Khusus |
	// Cuti Tidak Berbayar | Lainnya.
	'cuti.form.jenis': {
		fieldHint: 'Pilih sesuai keperluan: Tahunan, Sakit, Melahirkan, Khusus, Tidak Berbayar, atau Lainnya.',
		helpIcon: 'Salah pilih jenis berarti jatah yang terpotong juga salah, dan perlu dibatalkan lalu diajukan ulang.'
	},
	// canSubmit mensyaratkan subJenisCutiKhusus terisi bila jenisCuti === 'Cuti Khusus'.
	'cuti.form.jenisKhusus': {
		fieldHint: 'Wajib dipilih bila Anda memilih Cuti Khusus. Kuotanya terpisah dan tidak mengurangi jatah cuti tahunan.'
	},
	// calcJumlahHari melewati hari Sabtu (6) dan Minggu (0); canSubmit menolak jumlahHari === 0.
	'cuti.form.tanggal': {
		fieldHint: 'Sabtu dan Minggu tidak dihitung sebagai hari cuti. Kalau rentang yang Anda pilih hanya jatuh di akhir pekan, pengajuan tidak bisa dikirim.',
		type: 'warning',
		helpIcon: 'Angka "Jumlah Hari" di layar masih perkiraan. Hitungan final dilakukan server, yang juga memperhitungkan hari libur nasional.'
	},
	'cuti.form.alasan': {
		fieldHint: 'Opsional, tapi atasan biasanya menyetujui lebih cepat kalau alasannya jelas.'
	},
	// lampiranFile wajib (validasi klien+server) saat jenisCuti === 'Cuti Sakit' — dipakai gate
	// G_HRD_SAKIT untuk verifikasi Cuti Sakit >5 hari (lihat cuti_karyawan.lampiran, erp-epi-1).
	'cuti.form.lampiran': {
		fieldHint: 'Wajib untuk Cuti Sakit: unggah foto/PDF surat keterangan dokter dari faskes terdaftar. HRD memverifikasi keabsahan surat sebelum menyetujui.',
		helpIcon: 'Tanpa lampiran, pengajuan Cuti Sakit tidak bisa dikirim. Untuk jenis cuti lain, lampiran opsional (mis. akta untuk Cuti Melahirkan).'
	},

	// ---------- Lembur ----------
	'lembur.page': {
		sectionGuide: {
			title: 'Panduan: Ajukan Lembur',
			steps: [
				'Isi tanggal serta jam mulai dan jam selesai lembur',
				'Periksa Durasi dan Jam Setara Upah yang dihitung otomatis di bawahnya',
				'Kaitkan ke Proyek/SPK bila lemburnya untuk pekerjaan proyek tertentu',
				'Alasan/Pekerjaan wajib diisi — pengajuan tidak bisa dikirim tanpa itu'
			]
		}
	},
	// durasiJam menangani shift lintas tengah malam, jadi jam selesai boleh lebih kecil.
	'lembur.form.jam': {
		fieldHint: 'Jam selesai boleh lebih kecil dari jam mulai untuk lembur yang melewati tengah malam — durasinya tetap terhitung benar.'
	},
	// Pengali: hari kerja jam ke-1 @1.5x lalu sisanya @2.0x; hari libur 2.0x s/d 4.0x.
	'lembur.form.durasi': {
		fieldHint: 'Jam Setara Upah bukan sama dengan durasi: di hari kerja jam pertama dikali 1,5 dan sisanya dikali 2. Di hari libur pengalinya 2 sampai 4.',
		helpIcon: 'Angka di layar hanya estimasi. Nilai final ditentukan server saat pengajuan dikirim.'
	},
	'lembur.form.proyek': {
		fieldHint: 'Opsional. Isi bila lembur ini untuk proyek tertentu supaya biayanya masuk ke proyek itu.'
	},
	// canSubmit mensyaratkan alasan.trim().length > 0.
	'lembur.form.alasan': {
		fieldHint: 'Wajib diisi. Tulis pekerjaan apa yang dikerjakan, bukan sekadar "lembur".',
		type: 'warning'
	},

	// ---------- Kasbon ----------
	'kasbon.page': {
		sectionGuide: {
			title: 'Panduan: Ajukan Kasbon',
			steps: [
				'Perhatikan plafon dan tenor maksimum Anda yang tertera di bawah judul',
				'Isi nominal — tidak boleh melebihi plafon',
				'Pilih tenor cicilan; estimasi potongan per bulan muncul otomatis',
				'Keterangan wajib diisi sebagai dasar persetujuan'
			]
		}
	},
	// canSubmit: nominal > 0 && plafon > 0 && nominal <= plafon.
	'kasbon.form.nominal': {
		fieldHint: 'Tidak boleh melebihi plafon Anda. Bila plafon Anda 0, pengajuan kasbon memang belum diizinkan.',
		type: 'warning'
	},
	'kasbon.form.tenor': {
		fieldHint: 'Jumlah bulan cicilan. Makin panjang tenor, makin kecil potongan gaji bulanan Anda.',
		helpIcon: 'Cicilan dipotong langsung dari gaji setiap bulan sampai lunas.'
	},
	// canSubmit mensyaratkan keterangan.trim() tidak kosong.
	'kasbon.form.keterangan': {
		fieldHint: 'Wajib diisi. Jelaskan keperluannya — ini yang dibaca atasan saat menyetujui.',
		type: 'warning'
	},

	// ---------- Peminjaman Kendaraan ----------
	'kendaraan.page': {
		sectionGuide: {
			title: 'Panduan: Peminjaman Kendaraan & Kunjungan Lapangan',
			steps: [
				'Mulai dari kartu "Langkah berikutnya" di atas halaman — itu satu hal yang perlu Anda lakukan sekarang (ketuk tombol besarnya)',
				'Mengajukan cukup 4 hal: mau ke mana, kapan berangkat, perlu sopir atau tidak (wajib dipilih), dan jenis perjalanan. Agenda, unit pilihan, rencana kembali, dan catatan ada di "Opsi lanjutan"',
				'Ajukan sebelum batas minimal jam keberangkatan yang ditetapkan GA (terlihat di form); ketuk salah satu pilihan waktu cepat lalu ubah bila perlu',
				'Untuk Kunjungan Lapangan / Site Visit: pilih kategori kunjungan & zona (luar kota butuh 1 persetujuan tambahan)',
				'Tidak pakai kendaraan kantor? Matikan "Perlu kendaraan perusahaan" — tanpa unit, driver, atau P2H, cukup check-in di lokasi',
				'Setelah disetujui: isi P2H sebelum pakai (bila pakai kendaraan), lakukan check-in GPS di lokasi proyek',
				'Kembalikan kendaraan lewat P2H setelah pakai — pengembalian site visit ditolak bila belum ada catatan check-in (minta dispensasi GA bila check-in gagal)'
			]
		}
	},
	'site-checkin.page': {
		sectionGuide: {
			title: 'Panduan: Site Check-in Proyek',
			steps: [
				'Sebelum check-in, pastikan Lokasi akurat di HP menyala dan tunggu tanda 🟢',
				'Pilih proyek tujuan — bila datang dari peminjaman kendaraan, proyek sudah terisi otomatis',
				'Ambil lokasi GPS Anda dan foto bukti kehadiran (ter-watermark waktu & titik GPS)',
				'Bila titik proyek belum dipetakan dan Anda benar-benar di lokasi, tekan "Simpan Titik Ini sebagai Koordinat Proyek"',
				'Check-out saat selesai + isi ringkasan kegiatan; untuk kunjungan tanpa kendaraan, check-out menutup pengajuan Anda',
				'Kunjungan ke customer atau prospek? Catat lewat menu Sales → Kunjungan Baru (bukan di sini)'
			]
		}
	},
	'kendaraan.form.tujuan': {
		fieldHint: 'Tuliskan lokasi, kota, atau nama proyek yang akan dikunjungi secara jelas.',
		type: 'warning'
	},
	'kendaraan.form.waktu': {
		fieldHint: 'Pengajuan harus dilakukan sesuai batas minimal jam sebelum waktu berangkat (diatur GA).',
		helpIcon: 'Waktu selesai adalah estimasi rencana kembali. Jika ada keterlambatan, segera konfirmasi ke Admin GA.'
	},
	'kendaraan.form.kendaraan': {
		fieldHint: 'Pilihan unit bersifat preferensi. Penetapan unit final diputuskan oleh GA saat approve sesuai ketersediaan.',
		helpIcon: 'Unit bertanda "Tersedia" dapat langsung diajukan selama tidak bentrok dengan peminjaman lain.'
	},
	'kendaraan.form.driver': {
		fieldHint: 'Jika memilih "Bawa Sendiri", peminjam wajib memiliki SIM aktif dan bertanggung jawab penuh terhadap unit kendaraan.'
	},
	'kendaraan.form.tipe_keperluan': {
		fieldHint: 'Pilih jenis keperluan — menentukan data tambahan yang wajib diisi (mis. proyek untuk kunjungan lapangan) dan siapa yang mereview.',
		helpIcon: 'Form ini khusus meminjam armada kantor. Memakai kendaraan sendiri dan klaim BBM/tol? Catat di menu Biaya Lapangan, bukan di sini.'
	},
	'kendaraan.form.proyek': {
		fieldHint: 'Wajib diisi untuk keperluan Kunjungan Lapangan/Site Visit — dipakai untuk mengaitkan absen check-in Anda di proyek tujuan.',
		type: 'warning'
	},
	'kendaraan.bentrok': {
		fieldHint: 'Unit ini sudah dipakai di jam tersebut. Pilih unit lain, atau pilih "Tidak ada preferensi" agar GA yang mencarikan.',
		type: 'warning'
	},
	'bookings.approval_berjenjang': {
		fieldHint: 'Peminjaman disetujui 2 tahap: Manajer departemen Anda dulu, lalu GA/HRD memeriksa bentrok jadwal lintas seluruh departemen dan menetapkan unit final.'
	},
	'checklist.kenapa': {
		fieldHint: 'Checklist ini melindungi Anda — kondisi kendaraan tercatat sebelum & setelah pakai, jadi Anda tidak bisa dituduh atas kerusakan yang bukan salah Anda.'
	},
	'checklist.tahap': {
		fieldHint: '"Sebelum Pakai" wajib diisi sebelum kendaraan bisa dipakai. "Pengembalian" wajib diisi saat mengembalikan. Sudah terlanjur berangkat tanpa P2H? Pilih "Saya sudah terlanjur berangkat" di halaman Peminjaman.'
	},
	'checklist.item_kritis': {
		fieldHint: 'Item bertanda (*) adalah item kritis — kerusakan di item ini memblokir pemakaian kendaraan dan otomatis membuat tiket perbaikan ke GA.'
	},
	'checklist.tidak_laik': {
		fieldHint: 'Kendaraan tidak bisa dipakai sampai diperbaiki. Tiket perbaikan sudah dibuat otomatis — hubungi GA untuk unit pengganti.',
		type: 'warning'
	},
	'checklist.foto_odometer': {
		fieldHint: 'Foto odometer jadi bukti KM riil — dasar hitung BBM dan mencegah sengketa jarak tempuh.'
	}
};

