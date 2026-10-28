import type { HintModule } from './getHint';

// Ditulis 12 Agustus 2026 dengan memeriksa kode halaman lebih dulu, bukan dari asumsi:
//   src/routes/(app)/preventive/+page.svelte            (daftar unit)
//   src/routes/(app)/preventive/p2h/[equipment_id]/+page.svelte  (form P2H)
// Setiap klaim di bawah punya padanan nyata di kode — lihat komentar per kunci.

export const preventiveHints: HintModule = {
	// ---------- Daftar unit ----------
	'daftar.page': {
		sectionGuide: {
			title: 'Panduan: Ceklist Preventive',
			steps: [
				'Cari unit lewat nama atau kode, atau saring dengan Kategori dan Status P2H',
				'Unit bertanda "P2H Belum" adalah yang wajib Anda isi hari ini',
				'Ketuk unit untuk membuka ceklist P2H hariannya',
				'Tugas PM (servis berkala) yang jatuh tempo ditandai terpisah pada kartu unit'
			]
		}
	},
	'daftar.form.statusFilter': {
		fieldHint: 'Pilih "P2H Belum" untuk melihat hanya unit yang ceklist hariannya belum diisi.'
	},
	// Fase A0/A1 (P2H Alat Ukur QC, 5 Sep 2026): kategori "Alat Ukur & Instrumen QC" dan
	// "Referensi & Komparator Visual" dipakai QC Gudang, ceklistnya harian sama seperti unit lain.
	'daftar.form.alatUkur': {
		fieldHint:
			'Cek alat ukur setiap hari sebelum dipakai atau dipinjamkan. Isi pembacaan foil shim apa adanya — kalau meleset dari batas, tandai No-Go supaya alat ditahan dan dijadwalkan kalibrasi ulang.',
		type: 'info'
	},
	// conditionBadge() hanya mengenali 'breakdown' dan 'operational'; nilai lain
	// ditampilkan apa adanya dengan warna amber.
	'daftar.status.kondisi': {
		explain:
			'Kondisi operasional unit: Operational berarti unit laik jalan, Breakdown berarti unit sedang rusak dan tidak boleh dioperasikan. Status lain di luar keduanya ditampilkan apa adanya.'
	},
	'daftar.empty': {
		message: 'Belum ada unit yang terdaftar',
		hints: [
			'Unit didaftarkan oleh Admin Maintenance, bukan dari aplikasi lapangan',
			'Bila unit yang Anda pegang tidak muncul, hubungi Admin Maintenance'
		]
	},

	// ---------- Form P2H ----------
	'p2h.page': {
		sectionGuide: {
			title: 'Panduan: Ceklist P2H Harian',
			steps: [
				'Periksa tiap item, lalu tandai Go (aman) atau No-Go (bermasalah) — semua item wajib dijawab',
				'Item bertanda KRITIS wajib diperhatikan: temuan No-Go di sana menghentikan unit',
				'Item bertanda "Wajib" harus disertai foto bukti sebelum ceklist bisa dikirim',
				'Isi Tanda Tangan Digital di bagian bawah — tanpa ini ceklist tidak bisa dikirim',
				'Foto Unit, Keterangan Tambahan, dan Hour Meter/Kilometer sifatnya opsional'
			]
		}
	},
	// setResult() dipanggil tombol Go / No-Go; canSubmit mensyaratkan SEMUA item terjawab.
	'p2h.form.hasilItem': {
		fieldHint: 'Go = kondisi aman sesuai kriteria. No-Go = ada masalah. Semua item wajib dijawab sebelum ceklist bisa dikirim.'
	},
	// Input number otomatis menetapkan Go/No-Go dengan membandingkan min_value/max_value.
	'p2h.form.nilaiNumerik': {
		fieldHint: 'Isi angka hasil pengukuran. Sistem otomatis menandai Go atau No-Go dengan membandingkannya ke rentang aman item ini.',
		helpIcon: 'Kalau nilainya di luar rentang aman, item langsung berubah jadi No-Go — tidak perlu menekan tombol No-Go lagi.'
	},
	// t.wajib_foto → allRequiredPhotosAttached memblokir submit bila fotonya kosong.
	'p2h.form.fotoItem': {
		fieldHint: 'Item bertanda (Wajib) tidak bisa dikirim tanpa foto bukti. Tunggu sampai unggahan selesai sebelum menekan kirim.',
		type: 'warning'
	},
	// Catatan No-Go: placeholder-nya sendiri menyebut "(opsional)".
	'p2h.form.catatanNoGo': {
		fieldHint: 'Opsional, tapi sangat membantu mekanik. Tulis apa yang terlihat/terdengar, bukan hanya "rusak".'
	},
	'p2h.form.fotoUnit': {
		fieldHint: 'Opsional. Foto keseluruhan unit sebagai bukti kondisi saat pemeriksaan.'
	},
	'p2h.form.keterangan': {
		fieldHint: 'Opsional. Catatan umum untuk unit ini yang tidak terkait satu item tertentu.'
	},
	// signaturePad.isEmpty() → submit ditolak dengan pesan "Tanda tangan wajib diisi."
	'p2h.form.ttd': {
		fieldHint: 'Wajib. Ceklist tidak bisa dikirim sebelum Anda membubuhkan tanda tangan di kotak ini.',
		type: 'warning'
	},
	// Label field berganti Hour Meter / Kilometer tergantung jenis unit; keduanya opsional.
	'p2h.form.hourMeter': {
		fieldHint: 'Opsional. Isi angka yang terbaca di panel unit hari ini — dipakai untuk menghitung jadwal servis berikutnya.'
	},
	'p2h.status.kritis': {
		explain:
			'Item kritis: komponen yang menyangkut keselamatan atau kelayakan jalan. Temuan No-Go di item ini berarti unit tidak boleh dioperasikan sampai ditangani mekanik.'
	}
};
