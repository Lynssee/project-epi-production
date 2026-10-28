import type { HintModule } from './getHint';

// Ditulis 12 Agustus 2026 dengan memeriksa kode halaman lebih dulu:
//   src/routes/(app)/procurement/+page.svelte        (menu)
//   src/routes/(app)/procurement/ajukan/+page.svelte (ajukan pembelian / PR)
//   src/routes/(app)/procurement/terima/+page.svelte (terima barang PO)
//
// Nama modul sengaja "procurementLapangan", bukan "procurement", supaya tidak tertukar
// dengan src/lib/data/hints/procurement.js di dashboard admin yang isinya soal supplier.

export const procurementLapanganHints: HintModule = {
	// ---------- Menu ----------
	'menu.page': {
		sectionGuide: {
			title: 'Panduan: Procurement Lapangan',
			steps: [
				'Ajukan Pembelian: buat permintaan barang (PR) dari lapangan',
				'Approval Saya: setujui atau tolak pengajuan yang masuk ke Anda',
				'Terima Barang (PO): laporkan barang PO yang sudah sampai di lokasi',
				'Lacak Pesanan: pantau sudah sampai mana pengajuan Anda',
				'Beli Lokal (Reimburse): sudah terlanjur beli sendiri di lokasi? Ajukan penggantian di sini'
			]
		}
	},

	// ---------- Ajukan pembelian ----------
	'ajukan.page': {
		sectionGuide: {
			title: 'Panduan: Ajukan Pembelian',
			steps: [
				'Isi Departemen dan Tujuan Pengajuan — keduanya wajib',
				'Centang "jasa/non-stok" bila yang diminta bukan barang gudang (mis. jasa perbaikan atau sewa)',
				'Pilih Urgensi sesuai kebutuhan nyata, bukan selalu Urgent',
				'Tambahkan minimal satu item lengkap: nama barang, qty, satuan, dan estimasi harga',
				'Pengajuan barang stok direview Inventory dulu sebelum masuk antrian approval'
			]
		}
	},
	// handleSubmit menolak bila department kosong.
	'ajukan.form.departemen': {
		fieldHint: 'Wajib. Departemen menentukan anggaran mana yang dibebani dan siapa yang menyetujui.'
	},
	// isNonStock melewati stock gate Inventory.
	'ajukan.form.nonStok': {
		fieldHint: 'Centang hanya bila yang diminta bukan barang gudang — mis. jasa perbaikan atau sewa alat.',
		helpIcon: 'Mencentang ini melewati pengecekan stok gudang. Kalau barangnya sebenarnya ada di gudang, permintaan bisa jadi pembelian ganda.'
	},
	// Opsi nyata: Normal | Kloter | Urgent | Very Urgent.
	'ajukan.form.urgensi': {
		fieldHint: 'Normal = ikut jadwal biasa. Kloter = digabung pembelian berikutnya. Urgent dan Very Urgent memotong antrean.',
		helpIcon: 'Menandai semua pengajuan sebagai Urgent membuat prioritas kehilangan arti — pakai sesuai kebutuhan nyata.'
	},
	// handleSubmit menolak bila tujuanPengajuan kosong.
	'ajukan.form.tujuan': {
		fieldHint: 'Wajib. Jelaskan untuk apa barang ini dipakai — ini yang dibaca approver saat memutuskan.',
		type: 'warning'
	},
	'ajukan.form.tanggalDibutuhkan': {
		fieldHint: 'Tanggal barang benar-benar diperlukan di lokasi, bukan tanggal hari ini.'
	},
	// validItems: item dianggap sah bila terisi lengkap; minimal 1 wajib ada.
	'ajukan.form.item': {
		fieldHint: 'Minimal satu item harus terisi LENGKAP (nama, qty, satuan, estimasi harga). Item yang tidak lengkap diabaikan saat dikirim.',
		type: 'warning'
	},
	'ajukan.status.reviewStok': {
		explain:
			'Pengajuan barang stok tidak langsung ke approval. Inventory memeriksa dulu apakah barangnya sudah tersedia di gudang (anti-overbuy), baru diteruskan.'
	},

	// ---------- Terima barang ----------
	'terima.page': {
		sectionGuide: {
			title: 'Panduan: Terima Barang (PO)',
			steps: [
				'Pilih PO yang barangnya sudah sampai di lokasi Anda',
				'Isi qty yang benar-benar diterima per item — kolomnya sudah terisi sisa yang belum diterima',
				'Unggah foto bukti penerimaan bila diminta',
				'Laporan ini belum menggantikan penerimaan resmi gudang'
			]
		}
	},
	// qty_dilaporkan diisi awal dengan (quantity - received_qty); submit menolak bila
	// tidak ada satu pun item dengan qty > 0.
	'terima.form.qtyDiterima': {
		fieldHint: 'Sudah terisi otomatis dengan sisa yang belum diterima. Ubah bila yang datang lebih sedikit — minimal satu item harus lebih dari 0.',
		helpIcon: 'Angka "Sudah diterima resmi" di atasnya adalah catatan gudang. Yang Anda isi di sini adalah laporan kedatangan di lokasi.'
	},
	'terima.form.catatan': {
		fieldHint: 'Opsional. Tulis bila ada barang kurang, rusak, atau tidak sesuai pesanan.'
	},

	// ---------- Beli Lokal (Reimburse) ----------
	// Ditulis 26 Agustus 2026 dengan memeriksa kode halaman lebih dulu:
	//   src/routes/(app)/procurement/beli-lokal/+page.svelte
	// Beda dengan "Ajukan Pembelian": ini untuk barang yang SUDAH dibeli duluan (nota di
	// tangan), bukan permintaan sebelum beli. Approval-nya juga terpusat di admin (erp-epi-1),
	// bukan lewat "Approval Saya" di app ini.
	'beliLokal.page': {
		sectionGuide: {
			title: 'Panduan: Beli Lokal (Reimburse)',
			steps: [
				'Gunakan HANYA untuk barang/jasa yang SUDAH dibeli langsung di lokasi (bukan sebelum beli)',
				'Pilih proyek yang menanggung biaya ini — wajib',
				'Isi tanggal beli sesuai nota, bukan hari ini',
				'Unggah foto nota/kuitansi — wajib sebagai bukti',
				'Centang "Pembelian Darurat" HANYA bila tidak bisa menunggu hari kerja — wajib pilih jenis kedaruratan + alasan',
				'Approval dilakukan admin pusat; status bisa dipantau di riwayat pada halaman ini'
			]
		}
	},
	'beliLokal.form.modeDarurat': {
		fieldHint: 'Aktifkan hanya bila pembelian benar-benar tidak bisa menunggu hari kerja (mesin berhenti, bahaya keselamatan, material habis).',
		helpIcon: 'Mode darurat memotong antrean approval (dihitung dalam jam) dan tercatat khusus. Menandai pembelian biasa sebagai darurat membuat prioritas kehilangan arti.'
	},
	'beliLokal.form.klasifikasiDarurat': {
		fieldHint: 'Wajib bila mode darurat aktif. Pilih yang paling sesuai dengan kondisi di lapangan.'
	},
	'beliLokal.form.alasanDarurat': {
		fieldHint: 'Wajib minimal 15 karakter. Jelaskan singkat kenapa tidak bisa menunggu — ini yang dibaca approver.',
		type: 'warning'
	},
	'beliLokal.form.project': {
		fieldHint: 'Wajib. Menentukan RAB proyek mana yang menanggung biaya ini.'
	},
	'beliLokal.form.tanggalBeli': {
		fieldHint: 'Tanggal barang benar-benar dibeli sesuai nota — boleh beberapa hari lalu, jangan diisi tanggal hari ini kalau belinya bukan hari ini.'
	},
	'beliLokal.form.deskripsi': {
		fieldHint: 'Wajib. Uraikan barang/jasa yang dibeli — ini yang dibaca approver saat memutuskan.',
		type: 'warning'
	},
	'beliLokal.form.nominal': {
		fieldHint: 'Wajib. Isi sesuai total di nota, termasuk pajak bila ada.'
	},
	'beliLokal.form.notaFoto': {
		fieldHint: 'Wajib. Foto nota/kuitansi asli — jadi bukti utama saat approval.',
		helpIcon: 'Tanpa foto nota, pengajuan tidak bisa dikirim. Pastikan tulisan di nota terbaca jelas.'
	},
	'beliLokal.form.tempatBeli': {
		fieldHint: 'Nama toko boleh diketik bebas. Bila muncul saran vendor terdaftar, pilih yang cocok. Untuk nominal besar, wajib pilih vendor terdaftar atau isi alasan.'
	},
	'vendorDirektori.page': {
		sectionGuide: {
			title: 'Panduan: Direktori Vendor',
			steps: [
				'Cari vendor resmi per kota atau bidang usaha sebelum belanja di toko tak terdaftar.',
				'Vendor bertanda "✅ resmi" identitasnya lengkap — aman dipakai untuk nominal besar.',
				'Toko yang Anda pakai tidak ada di daftar? Klik "Usul Vendor" agar Procurement mendaftarkannya.'
			]
		}
	},
	'vendorDirektori.filter': {
		fieldHint: 'Isi salah satu atau kombinasi: nama toko, kota, atau bidang (mis. besi, cat, sewa alat). Hasil muncul otomatis.'
	},
	'vendorUsul.page': {
		sectionGuide: {
			title: 'Panduan: Usul Vendor Baru',
			steps: [
				'Isi nama toko + kontak. Foto papan nama & lokasi GPS mempercepat verifikasi Procurement.',
				'Sebutkan barang/jasa yang dijual agar mudah dicari tim lain.',
				'Usulan masuk antrian Procurement — bukan pendaftaran instan.'
			]
		}
	},
	'vendorUsul.form.catatan': {
		fieldHint: 'Contoh: "Jual besi beton, semen, cat. Bisa antar ke lokasi proyek."'
	},
	'beliLokal.status.paguWarning': {
		explain:
			'Sistem mengecek perkiraan sisa pagu RAB proyek saat Anda mengajukan. Peringatan ini bukan penolakan otomatis — approver tetap yang memutuskan, tapi pertimbangkan untuk konfirmasi dulu ke PM Proyek bila muncul.',
		type: 'warning'
	}
};
