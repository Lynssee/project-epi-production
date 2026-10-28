import type { HintModule } from './getHint';

// src/lib/data/hints/anggaran.ts
// Modul hint Pengajuan Anggaran Lapangan (project-epi).
// Menjelaskan pemicu, sumbu anggaran proyek (RAB), kategori belanja,
// serta persyaratan dokumen dan gate validasi.

export const anggaranHints: HintModule = {
	// ---------- Halaman Form Pengajuan Baru ----------
	'baru.sectionGuide': {
		sectionGuide: {
			title: 'Panduan Pengajuan Anggaran Lapangan',
			steps: [
				'Pilih kartu Kategori yang paling sesuai (Operasional, BBM/Transport, Material, Sewa Alat, Petty Cash, Subkon/Jasa, Upah Manpower, Lain-lain) — beberapa kategori punya sub-kategori, klik untuk melihatnya.',
				'Proyek Terkait otomatis jadi wajib untuk kategori tertentu (mis. Upah Manpower) — tidak perlu ditentukan manual, ikuti kategori yang dipilih.',
				'Lengkapi rincian pos anggaran: deskripsi jelas, jumlah, dan harga estimasi.',
				'Lampirkan bukti fisik (foto nota/kuitansi/penawaran) atau sertakan alasan pengecualian resmi — kategori yang mewajibkannya ditandai otomatis.',
				'Pastikan data proyek lengkap (Timeline, Laporan Harian, Manpower) sebelum submit.'
			]
		}
	},
	'baru.form.proyek': {
		fieldHint: 'Wajib untuk kategori yang mengharuskannya (mis. Upah Manpower) — ikuti kategori yang Anda pilih di atas.',
		helpIcon: 'Proyek harus sudah memiliki Timeline Planning (G9), Laporan Harian aktif (G10), dan Penugasan Manpower (G11).'
	},
	'baru.form.kategori': {
		fieldHint: 'Pilih kartu kategori yang paling sesuai — beberapa punya sub-kategori (klik untuk melihat). Field tambahan menyesuaikan otomatis per kategori.',
		helpIcon: 'Kategori yang mewajibkan lampiran (badge "Wajib") harus melampirkan berkas nota/kuitansi (G8) dan diselesaikan SPJ maks 14 hari pasca pencairan (G17) — cek batas hari spesifik kategori bila berbeda dari default.'
	},
	'baru.form.tujuan': {
		fieldHint: 'Wajib. Jelaskan tujuan dan urgensi penggunaan dana untuk diverifikasi oleh Project Finance.',
		type: 'warning'
	},
	'baru.form.tanggalDibutuhkan': {
		fieldHint: 'Wajib. Tanggal dana benar-benar harus cair dan tersedia di lapangan.'
	},
	'baru.form.lampiran': {
		fieldHint: 'Wajib untuk kategori operasional. Unggah foto nota, kuitansi, atau estimasi harga.',
		helpIcon: 'Jika bukti fisik belum ada/hilang, pilih alasan pengecualian terstruktur dan tuliskan keterangan minimal 15 karakter.'
	},
	'baru.form.item': {
		fieldHint: 'Masukkan item belanja secara spesifik beserta satuan dan harga estimasi pasar.',
		type: 'warning'
	},
	'baru.form.penerima': {
		fieldHint: 'Pilih rekening transfer atau tunai. Pastikan nama rekening valid untuk kelancaran transfer bank.',
		type: 'warning'
	},
	// Penajaman Penerima Dana & Track Record v2, Fase 4 (11 Sep 2026) — RekeningSelect
	// menggantikan input teks bebas rekening; "5 rekening terakhir saya" tampil begitu
	// dibuka. Rekening baru WAJIB verifikasi Finance dulu (keputusan user §9.4) sebelum
	// pencairan pertamanya — PA tetap bisa dikirim (Aturan #6: jangan matikan tombol
	// tanpa alternatif), hanya pencairannya yang bisa lebih lama.
	'baru.form.rekening': {
		fieldHint: 'Cari dari "Rekening Terakhir Saya" untuk 1 tap pakai lagi, atau daftarkan rekening baru. Rekening baru wajib diverifikasi Finance dulu — pencairan pertama bisa lebih lama.',
		helpIcon: 'Rekening yang sudah terverifikasi (✅) dicairkan lebih cepat. Bukan tagihan/virtual account? Aktifkan toggle "Tagihan/VA" — kode VA tidak perlu didaftarkan ke registri.',
		type: 'warning'
	}
};
