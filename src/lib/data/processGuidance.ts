// src/lib/data/processGuidance.ts
// Panduan alur bisnis Sales → Inventory (versi lapangan, teks). Cermin dari
// erp-epi `src/lib/config/processGuidanceConfig.js` (Visual Business Process Guidance, Fase 1-3):
// id node/edge SAMA supaya tautan lintas aplikasi konsisten; BEDA di `actions` (route project-epi)
// dan tanpa `gates` (pengaturan gate hanya di dashboard admin).
// Data dibundel ke JS → otomatis tersedia offline selama app shell sudah termuat (pola sama panduan.ts).
// Fase 5 (admin): dipindah ke Directus; salinan ini jadi fallback.

export type ProcessNodeType = 'start' | 'task' | 'decision' | 'end';

export interface ProcessAction {
	label: string;
	href: string;
}

export interface ProcessNode {
	id: string;
	type: ProcessNodeType;
	lane: string;
	col: number;
	row?: number;
	label: string;
	desc: string;
	pic?: string;
	checklist?: string[];
	blockers?: string[];
	actions?: ProcessAction[];
}

export interface ProcessEdge {
	from: string;
	to: string;
	label?: string;
}

export interface ProcessFlow {
	id: string;
	title: string;
	description: string;
	lanes: { key: string; label: string }[];
	nodes: ProcessNode[];
	edges: ProcessEdge[];
}

export const PROCESS_FLOWS: ProcessFlow[] = [
	{
		id: 'sales_to_inventory',
		title: 'Alur Penjualan hingga Kesiapan Produk',
		description:
			'Dari survey customer sampai barang siap dikirim, proyek lapangan berjalan, atau sewa alat selesai. Ketuk satu langkah untuk melihat apa yang harus dilakukan.',
		lanes: [
			{ key: 'sales', label: 'SALES' },
			{ key: 'inventory', label: 'INVENTORY' },
			{ key: 'produksi', label: 'PRODUKSI' },
			{ key: 'proyek', label: 'PROYEK LAPANGAN' }
		],
		nodes: [
			{
				id: 'start', type: 'start', lane: 'sales', col: 0, label: 'Mulai',
				desc: 'Customer menghubungi Sales atau Sales menemukan calon pembeli.',
				pic: 'Sales',
				checklist: ['Catat calon customer/prospect di sistem sebelum survey.'],
				actions: [{ label: 'Prospek Sales', href: '/sales/prospek' }]
			},
			{
				id: 'survey', type: 'task', lane: 'sales', col: 1, label: 'Survey',
				desc: 'Sales/tim survey meninjau kebutuhan dan kondisi lokasi customer. Hasil survey menjadi dasar penawaran.',
				pic: 'Sales / Tim Survey',
				checklist: ['Pilih prospect atau customer yang disurvey.', 'Catat kebutuhan, ukuran/volume, dan kondisi lokasi.', 'Tandai survey selesai agar penawaran tidak mendapat peringatan.'],
				blockers: ['Survey belum ditandai selesai → penawaran tetap bisa dibuat tetapi muncul peringatan.'],
				actions: [{ label: 'Buka Survey', href: '/sales/survey' }]
			},
			{
				id: 'penawaran', type: 'decision', lane: 'sales', col: 2, label: 'Penawaran',
				desc: 'Penawaran dikirim ke customer. Ditolak → kembali ke Survey untuk penyesuaian; diterima → lanjut Sales Order.',
				pic: 'Sales',
				checklist: ['Prospect/customer sudah dipilih.', 'Minimal 1 item penawaran terisi.', 'Harga tidak di bawah estimasi kasar hasil survey.', 'Penawaran dikirim dan keputusan customer dicatat (diterima/ditolak).'],
				blockers: ['Penawaran tanpa customer atau tanpa item tidak bisa disimpan.', 'Harga di bawah estimasi survey memicu peringatan.'],
				actions: [{ label: 'Buka Penawaran', href: '/sales/penawaran' }]
			},
			{
				id: 'so', type: 'decision', lane: 'sales', col: 3, label: 'Sales Order (PO)',
				desc: 'PO customer dicatat. Jenisnya menentukan jalur: PO Jasa (pekerjaan proyek), PO Cat (pengadaan produk), atau PO Rental (sewa alat keluar). PO kombinasi Jasa + Cat mengikuti KEDUA jalur. SO yang tipenya masih kosong (data lama) tidak punya jalur otomatis — lengkapi tipe SO-nya.',
				pic: 'Sales, Admin Kontrak/Legal, Finance (credit check)',
				checklist: ['Data legal customer lengkap (NPWP/NIK & PIC).', 'Dokumen PO diunggah dan diverifikasi Admin Kontrak/Legal.', 'Nomor PO tidak duplikat.', 'Margin sesuai batas minimum kategori.', 'Credit check Finance selesai dan customer bebas tunggakan jatuh tempo.', 'Lampiran wajib sesuai kategori terpenuhi.', 'Pilih tipe SO yang benar (Jasa / Cat / Rental).'],
				blockers: ['SO tertahan Credit Hold menunggu keputusan Finance.', 'Dokumen PO belum diverifikasi.', 'Customer masih punya invoice jatuh tempo.', 'Tipe SO kosong → jalur lanjutan tidak jelas.'],
				actions: [{ label: 'PO Customer', href: '/sales/po' }]
			},
			{
				id: 'spk_proyek', type: 'task', lane: 'sales', col: 4, row: 1, label: 'Form SPK Proyek',
				desc: 'Untuk PO Jasa: Sales menyusun SPK Proyek sebagai dasar pekerjaan lapangan.',
				pic: 'Sales, Project Control',
				checklist: ['Survey dan kunjungan sales untuk SO Jasa sudah tercatat.', 'SPK/Proyek diterbitkan dan tertaut ke SO.', 'Project Leader ditugaskan.'],
				blockers: ['SO Jasa belum punya survey/kunjungan tercatat.', 'SPK/Proyek belum tertaut ke SO (handover belum siap).'],
				actions: [{ label: 'Buka Proyek', href: '/proyek' }, { label: 'PO Customer', href: '/sales/po' }]
			},
			{
				id: 'minta_produk', type: 'task', lane: 'sales', col: 4, row: 0, label: 'Permintaan Produk',
				desc: 'Untuk PO Cat: Sales mengajukan permintaan produk ke Inventory.',
				pic: 'Sales',
				checklist: ['Item produk dan jumlah sesuai PO.', 'Tanggal target kirim terisi dan realistis.', 'Bila perlu, hasil uji sample/mockup cat sudah disetujui.'],
				blockers: ['Hasil uji sample cat belum disetujui.', 'Tanggal target kirim kosong.'],
				actions: [{ label: 'PO Customer', href: '/sales/po' }]
			},
			{
				id: 'kontrak_sewa', type: 'task', lane: 'sales', col: 4, row: 2, label: 'Kontrak Sewa Alat',
				desc: 'Untuk PO Rental (sewa alat keluar ke customer): buat kontrak sewa dari SO — pilih jenis alat dan tipe tagihan — lalu terima deposit/uang jaminan.',
				pic: 'Sales, Finance (deposit)',
				checklist: ['Buat kontrak sewa dari SO rental: jenis alat & tipe tagihan (lump sum/harian/mingguan/bulanan/hour meter).', 'Konfirmasi terima deposit saat uang jaminan masuk (otomatis dijurnal sebagai utang jaminan, bukan pendapatan).'],
				blockers: ['Kontrak belum dibuat untuk SO rental.', 'Deposit belum dikonfirmasi Finance.'],
				actions: [{ label: 'Sewa Keluar', href: '/sewa-keluar' }]
			},
			{
				id: 'timesheet_sewa', type: 'task', lane: 'sales', col: 5, row: 2, label: 'Timesheet & Tagihan Sewa',
				desc: 'Selama masa sewa berjalan: catat timesheet (jam operasi/hour meter) dan standby charge bila area customer belum siap, lalu tagih sesuai tipe tagihan kontrak.',
				pic: 'Operasional Alat, Sales',
				checklist: ['Catat timesheet berkala.', 'Catat standby charge bila ada.', 'Kirim laporan dan tagihan sesuai tipe tagihan.'],
				blockers: ['Timesheet tidak diisi → tagihan tidak punya dasar.', 'Kontrak sewa sedang dihentikan sementara (suspended).'],
				actions: [{ label: 'Sewa Keluar', href: '/sewa-keluar' }]
			},
			{
				id: 'sewa_selesai', type: 'end', lane: 'sales', col: 6, row: 2, label: 'Sewa Selesai',
				desc: 'Alat kembali: klik "Alat Kembali & Kembalikan Deposit" pada kontrak — deposit dikembalikan utuh atau dipotong denda kerusakan/keterlambatan, otomatis dijurnal.',
				pic: 'Finance, Sales',
				checklist: ['Periksa kondisi alat saat kembali.', 'Kembalikan deposit (utuh atau dipotong denda) dan pastikan jurnal tercatat.'],
				actions: [{ label: 'Sewa Keluar', href: '/sewa-keluar' }]
			},
			{
				id: 'cek_produk', type: 'decision', lane: 'inventory', col: 5, label: 'Check Produk',
				desc: 'Inventory memeriksa ketersediaan stok produk yang diminta.',
				pic: 'Admin Gudang (Inventory)',
				checklist: ['Bandingkan stok tersedia dengan yang sudah dialokasikan.', 'Putuskan: stok ada → alokasi; tidak ada → beli (PR) atau produksi (SPK).'],
				blockers: ['Stok fisik tidak sama dengan stok sistem.'],
				actions: [{ label: 'Stok Lapangan', href: '/stock-lapangan' }]
			},
			{
				id: 'alokasi', type: 'task', lane: 'inventory', col: 6, row: 0, label: 'Alokasi Pengeluaran Barang',
				desc: 'Stok tersedia: barang dialokasikan dan disiapkan untuk pengeluaran/pengiriman.',
				pic: 'Admin Gudang (Inventory)',
				checklist: ['Buat pengeluaran barang/packing list untuk item yang tersedia.', 'Stok mencukupi dan tautan proyek benar.'],
				blockers: ['Stok tidak mencukupi saat dialokasikan.', 'Tautan/status proyek pada packing list belum benar.'],
				actions: [{ label: 'Packing List', href: '/packing-list' }]
			},
			{
				id: 'pr_beli', type: 'task', lane: 'inventory', col: 6, row: 1, label: 'PR Pembelian',
				desc: 'Stok tidak ada: Inventory mengajukan pembelian (PR) ke supplier.',
				pic: 'Admin Gudang, Procurement',
				checklist: ['PR memuat item dan jumlah yang kurang saja (hindari overbuy).', 'Bila untuk proyek, tautkan ke proyek dan patuhi pagunya.'],
				blockers: ['Jumlah melebihi titik pemesanan ulang atau batas stok maksimum.', 'Tautan/pagu proyek belum sesuai.'],
				actions: [{ label: 'Pengajuan Pembelian (PR)', href: '/requisition' }]
			},
			{
				id: 'spk_produksi', type: 'task', lane: 'produksi', col: 6, label: 'SPK Produksi',
				desc: 'Stok tidak ada dan barang diproduksi sendiri: terbitkan SPK Produksi.',
				pic: 'PPIC / Produksi',
				checklist: ['SPK Produksi terbit dan tertaut ke SO.', 'Bahan baku tersedia untuk batch.'],
				blockers: ['SPK/Proyek belum tertaut ke SO (handover belum siap).'],
				actions: [{ label: 'Produksi', href: '/produksi' }]
			},
			{
				id: 'selesai_barang', type: 'end', lane: 'inventory', col: 7, row: 0, label: 'Barang Siap Kirim',
				desc: 'Barang sudah dialokasikan dan siap dikeluarkan lewat Surat Jalan.',
				pic: 'Admin Gudang, Logistik',
				checklist: ['Barang lengkap sesuai alokasi.', 'Surat Jalan diterbitkan saat barang keluar.'],
				actions: [{ label: 'Packing List', href: '/packing-list' }]
			},
			{
				id: 'proyek_jalan', type: 'end', lane: 'proyek', col: 5, label: 'Proyek Berjalan',
				desc: 'SPK Proyek terbit; tim lapangan mulai bekerja dan mengisi laporan harian.',
				pic: 'Project Leader',
				checklist: ['Leader dan Co-Leader proyek ditugaskan.', 'Jadwal kickoff ditetapkan dan dijalankan.', 'Laporan harian diisi rutin.'],
				blockers: ['Leader proyek belum ditugaskan.', 'Jadwal kickoff terlewat.'],
				actions: [{ label: 'Laporan Harian', href: '/laporan' }, { label: 'Buka Proyek', href: '/proyek' }]
			}
		],
		edges: [
			{ from: 'start', to: 'survey' },
			{ from: 'survey', to: 'penawaran' },
			{ from: 'penawaran', to: 'survey', label: 'ditolak' },
			{ from: 'penawaran', to: 'so', label: 'diterima' },
			{ from: 'so', to: 'minta_produk', label: 'PO Cat' },
			{ from: 'so', to: 'spk_proyek', label: 'PO Jasa' },
			{ from: 'so', to: 'kontrak_sewa', label: 'PO Rental' },
			{ from: 'spk_proyek', to: 'proyek_jalan' },
			{ from: 'kontrak_sewa', to: 'timesheet_sewa' },
			{ from: 'timesheet_sewa', to: 'sewa_selesai' },
			{ from: 'minta_produk', to: 'cek_produk' },
			{ from: 'cek_produk', to: 'alokasi', label: 'ada' },
			{ from: 'cek_produk', to: 'pr_beli', label: 'tdk ada (beli)' },
			{ from: 'cek_produk', to: 'spk_produksi', label: 'tdk ada (produksi)' },
			{ from: 'pr_beli', to: 'selesai_barang', label: 'barang datang' },
			{ from: 'spk_produksi', to: 'selesai_barang', label: 'produksi selesai' },
			{ from: 'alokasi', to: 'selesai_barang' }
		]
	}
];

export function getProcessFlow(id: string): ProcessFlow | null {
	return PROCESS_FLOWS.find((f) => f.id === id) || null;
}
