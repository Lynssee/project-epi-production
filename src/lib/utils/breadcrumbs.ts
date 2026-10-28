// src/lib/utils/breadcrumbs.ts

export interface BreadcrumbItem {
	label: string;
	href?: string;
}

export interface BreadcrumbResult {
	breadcrumb: BreadcrumbItem[];
	title: string;
	parentHref?: string;
}

const STATIC_ROUTE_MAP: Record<string, BreadcrumbResult> = {
	// Menu Utama
	'/': {
		breadcrumb: [{ label: 'Menu Utama' }, { label: 'Beranda' }],
		title: 'Beranda',
		parentHref: '/'
	},
	'/command-center': {
		breadcrumb: [{ label: 'Menu Utama' }, { label: 'Command Center' }],
		title: 'Command Center',
		parentHref: '/'
	},
	'/pusat-pengajuan': {
		breadcrumb: [{ label: 'Menu Utama' }, { label: 'Pusat Pengajuan' }],
		title: 'Pusat Pengajuan',
		parentHref: '/'
	},
	'/notifikasi': {
		breadcrumb: [{ label: 'Menu Utama' }, { label: 'Notifikasi' }],
		title: 'Pusat Notifikasi',
		parentHref: '/'
	},
	'/omnichannel': {
		breadcrumb: [{ label: 'Menu Utama' }, { label: 'Omnichannel' }],
		title: 'Omnichannel Komunikasi',
		parentHref: '/'
	},

	// Departemen: Project
	'/proyek/hub': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project' }],
		title: 'Hub Departemen Project',
		parentHref: '/'
	},
	'/proyek': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'List Project' }],
		title: 'List Project',
		parentHref: '/proyek/hub'
	},
	'/laporan': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'Laporan Harian' }],
		title: 'Laporan Harian',
		parentHref: '/proyek/hub'
	},
	'/laporan/general': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'Laporan Harian', href: '/laporan' }, { label: 'General' }],
		title: 'Laporan Harian General',
		parentHref: '/laporan'
	},
	'/biaya-lapangan': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'Biaya Lapangan' }],
		title: 'Biaya Lapangan',
		parentHref: '/proyek/hub'
	},
	'/packing-list': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'Packing List' }],
		title: 'Packing List',
		parentHref: '/proyek/hub'
	},
	'/packing-list/baru': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'Packing List', href: '/packing-list' }, { label: 'Buat Baru' }],
		title: 'Buat Packing List',
		parentHref: '/packing-list'
	},
	'/packing-list/return': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'Packing List', href: '/packing-list' }, { label: 'Return' }],
		title: 'Return Packing List',
		parentHref: '/packing-list'
	},
	'/anggaran': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'Keuangan & Anggaran' }],
		title: 'Keuangan & Anggaran',
		parentHref: '/proyek/hub'
	},
	'/anggaran/baru': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'Keuangan & Anggaran', href: '/anggaran' }, { label: 'Pengajuan Baru' }],
		title: 'Pengajuan Anggaran Baru',
		parentHref: '/anggaran'
	},
	'/anggaran/cek-gate': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'Keuangan & Anggaran', href: '/anggaran' }, { label: 'Cek Kesiapan' }],
		title: 'Cek Kesiapan Pengajuan',
		parentHref: '/anggaran'
	},
	'/rap-aktual': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'RAP vs Realisasi' }],
		title: 'RAP vs Realisasi',
		parentHref: '/proyek/hub'
	},
	'/rap-aktual/terpusat': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'RAB & Realisasi Terpusat' }],
		title: 'RAB & Realisasi Terpusat',
		parentHref: '/proyek/hub'
	},
	'/manpower': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'Manpower & Tim' }],
		title: 'Manpower & Tim',
		parentHref: '/proyek/hub'
	},
	'/manpower/lembur': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'Manpower & Tim', href: '/manpower' }, { label: 'Lembur' }],
		title: 'Manpower Lembur',
		parentHref: '/manpower'
	},
	'/manpower/rating': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'Manpower & Tim', href: '/manpower' }, { label: 'Rating' }],
		title: 'Rating Manpower',
		parentHref: '/manpower'
	},
	'/manpower/payroll-terpusat': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'Manpower & Tim', href: '/manpower' }, { label: 'Payroll Terpusat' }],
		title: 'Payroll Terpusat',
		parentHref: '/manpower'
	},
	'/manpower-rencana-realisasi': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'Manpower & Tim', href: '/manpower' }, { label: 'Rencana vs Realisasi' }],
		title: 'Manpower Rencana vs Realisasi',
		parentHref: '/manpower'
	},
	'/manpower-dobel-override-log': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'Manpower & Tim', href: '/manpower' }, { label: 'Audit Override Log' }],
		title: 'Audit Log Override Dobel-Proyek',
		parentHref: '/manpower'
	},
	'/leader': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'Leader Hub & Regu' }],
		title: 'Leader Hub & Regu',
		parentHref: '/proyek/hub'
	},
	'/regu': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'Leader & Regu', href: '/leader' }, { label: 'Regu Kerja' }],
		title: 'Regu Kerja Proyek',
		parentHref: '/leader'
	},
	'/timeline': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'Timeline & Jadwal' }],
		title: 'Timeline & Jadwal',
		parentHref: '/proyek/hub'
	},
	'/inventory-proyek/opname': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'Opname Inventaris' }],
		title: 'Opname Inventaris Proyek',
		parentHref: '/proyek/hub'
	},
	'/inventory-proyek/kritis-terpusat': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'Stok Kritis Terpusat' }],
		title: 'Stok Kritis Terpusat',
		parentHref: '/proyek/hub'
	},
	'/inventory-proyek/barang-menganggur': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'Barang Menganggur Lintas Proyek' }],
		title: 'Barang Menganggur Lintas Proyek',
		parentHref: '/proyek/hub'
	},
	'/inventory-proyek/saldo-semua': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'Saldo Stok Semua Proyek' }],
		title: 'Saldo Stok Semua Proyek',
		parentHref: '/proyek/hub'
	},
	'/kontrak-terpusat': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'Kontrak Jatuh Tempo' }],
		title: 'Kontrak Jatuh Tempo',
		parentHref: '/proyek/hub'
	},
	'/spk-terpusat': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'SPK Jatuh Tempo' }],
		title: 'SPK Jatuh Tempo Terpusat',
		parentHref: '/proyek/hub'
	},
	'/kasbon-terpusat': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'Kasbon Manpower' }],
		title: 'Kasbon Manpower Terpusat',
		parentHref: '/proyek/hub'
	},
	'/todo-terpusat': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'To-Do Terpusat' }],
		title: 'To-Do Terpusat Proyek',
		parentHref: '/proyek/hub'
	},
	'/closing-evaluasi-terpusat': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Project', href: '/proyek/hub' }, { label: 'Closing & Evaluasi' }],
		title: 'Closing / Evaluasi Terpusat',
		parentHref: '/proyek/hub'
	},

	// Departemen: Maintenance & Bengkel
	'/perawatan': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Maintenance & Bengkel' }],
		title: 'Hub Perawatan',
		parentHref: '/'
	},
	'/preventive': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Maintenance & Bengkel', href: '/perawatan' }, { label: 'Preventive Maintenance' }],
		title: 'Preventive Maintenance',
		parentHref: '/perawatan'
	},
	'/preventive/audit-penempatan': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Maintenance & Bengkel', href: '/perawatan' }, { label: 'Preventive', href: '/preventive' }, { label: 'Audit Penempatan' }],
		title: 'Audit Penempatan Alat',
		parentHref: '/preventive'
	},
	'/maintenance': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Maintenance & Bengkel', href: '/perawatan' }, { label: 'Dashboard' }],
		title: 'Dashboard Maintenance',
		parentHref: '/perawatan'
	},
	'/maintenance/work-order': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Maintenance & Bengkel', href: '/perawatan' }, { label: 'Work Order' }],
		title: 'Work Order Saya',
		parentHref: '/perawatan'
	},
	'/maintenance/survey': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Maintenance & Bengkel', href: '/perawatan' }, { label: 'Survey & Tiket' }],
		title: 'Survey & Tiket Saya',
		parentHref: '/perawatan'
	},
	'/maintenance/survey/baru': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Maintenance & Bengkel', href: '/perawatan' }, { label: 'Survey & Tiket', href: '/maintenance/survey' }, { label: 'Buat Baru' }],
		title: 'Buat Survey Maintenance',
		parentHref: '/maintenance/survey'
	},
	'/maintenance/pinjaman-saya': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Maintenance & Bengkel', href: '/perawatan' }, { label: 'Pinjaman Alat' }],
		title: 'Pinjaman Alat Saya',
		parentHref: '/perawatan'
	},
	'/maintenance/servis-luar': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Maintenance & Bengkel', href: '/perawatan' }, { label: 'Servis Luar' }],
		title: 'Servis Luar (Bengkel Rekanan)',
		parentHref: '/perawatan'
	},
	'/support': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Maintenance & Bengkel', href: '/perawatan' }, { label: 'Support Lapangan' }],
		title: 'Support & Tiket Lapangan',
		parentHref: '/perawatan'
	},
	'/support/baru': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Maintenance & Bengkel', href: '/perawatan' }, { label: 'Support Lapangan', href: '/support' }, { label: 'Buat Tiket' }],
		title: 'Buat Tiket Support',
		parentHref: '/support'
	},

	// Departemen: Inventory & Logistik
	'/barang': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik' }],
		title: 'Hub Barang & Logistik',
		parentHref: '/'
	},
	'/stock-lapangan': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Stok Lapangan' }],
		title: 'Stok Lapangan',
		parentHref: '/barang'
	},
	'/stock-lapangan/masuk': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Stok Lapangan', href: '/stock-lapangan' }, { label: 'Stok Masuk' }],
		title: 'Penerimaan Stok Lapangan',
		parentHref: '/stock-lapangan'
	},
	'/stock-lapangan/antrian': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Stok Lapangan', href: '/stock-lapangan' }, { label: 'Antrian' }],
		title: 'Antrian Pengeluaran Stok',
		parentHref: '/stock-lapangan'
	},
	'/stock-lapangan/cek-area': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Stok Lapangan', href: '/stock-lapangan' }, { label: 'Cek Area' }],
		title: 'Cek Area Gudang Lapangan',
		parentHref: '/stock-lapangan'
	},
	'/stock-lapangan/komplain': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Stok Lapangan', href: '/stock-lapangan' }, { label: 'Komplain' }],
		title: 'Komplain & Retur Barang',
		parentHref: '/stock-lapangan'
	},
	'/stock-lapangan/opname': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Stok Lapangan', href: '/stock-lapangan' }, { label: 'Opname' }],
		title: 'Stock Opname Lapangan',
		parentHref: '/stock-lapangan'
	},
	'/stock-lapangan/output': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Stok Lapangan', href: '/stock-lapangan' }, { label: 'Output' }],
		title: 'Laporan Pengeluaran Stok',
		parentHref: '/stock-lapangan'
	},
	'/stock-lapangan/persiapan': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Stok Lapangan', href: '/stock-lapangan' }, { label: 'Persiapan Material' }],
		title: 'Persiapan Material & Barang',
		parentHref: '/stock-lapangan'
	},
	'/stock-lapangan/persiapan/bahan-baku': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Stok Lapangan', href: '/stock-lapangan' }, { label: 'Persiapan', href: '/stock-lapangan/persiapan' }, { label: 'Bahan Baku' }],
		title: 'Persiapan Bahan Baku',
		parentHref: '/stock-lapangan/persiapan'
	},
	'/stock-lapangan/persiapan/finish-good': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Stok Lapangan', href: '/stock-lapangan' }, { label: 'Persiapan', href: '/stock-lapangan/persiapan' }, { label: 'Finish Good' }],
		title: 'Persiapan Finish Good',
		parentHref: '/stock-lapangan/persiapan'
	},
	'/stock-lapangan/riwayat': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Stok Lapangan', href: '/stock-lapangan' }, { label: 'Riwayat' }],
		title: 'Riwayat Transaksi Stok',
		parentHref: '/stock-lapangan'
	},
	'/requisition': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Requisition' }],
		title: 'Requisition Proyek',
		parentHref: '/barang'
	},
	'/requisition/new': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Requisition', href: '/requisition' }, { label: 'Pengajuan Baru' }],
		title: 'Pengajuan Requisition Baru',
		parentHref: '/requisition'
	},
	'/packing-list/pick': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Picking Barcode' }],
		title: 'Picking Barcode',
		parentHref: '/barang'
	},
	'/sji': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Surat Jalan Internal' }],
		title: 'Surat Jalan Internal (SJI)',
		parentHref: '/barang'
	},
	'/sji/ajukan': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Surat Jalan Internal', href: '/sji' }, { label: 'Ajukan SJI' }],
		title: 'Pengajuan Surat Jalan Internal',
		parentHref: '/sji'
	},
	'/sji/konfirmasi': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Surat Jalan Internal', href: '/sji' }, { label: 'Konfirmasi' }],
		title: 'Konfirmasi Penerimaan SJI',
		parentHref: '/sji'
	},
	'/sj-manual': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Surat Jalan Manual' }],
		title: 'Surat Jalan Manual',
		parentHref: '/barang'
	},
	'/sj-manual/ajukan': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Surat Jalan Manual', href: '/sj-manual' }, { label: 'Ajukan Baru' }],
		title: 'Form Surat Jalan Manual',
		parentHref: '/sj-manual'
	},
	'/driver': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Driver App' }],
		title: 'Driver App (Logistik)',
		parentHref: '/barang'
	},
	'/driver/check': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Driver App', href: '/driver' }, { label: 'Pemeriksaan' }],
		title: 'Pemeriksaan Armada Driver',
		parentHref: '/driver'
	},
	'/driver/delegasi': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Driver App', href: '/driver' }, { label: 'Delegasi' }],
		title: 'Delegasi Tugas Driver',
		parentHref: '/driver'
	},
	'/driver/trip/baru': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Driver App', href: '/driver' }, { label: 'Trip Baru' }],
		title: 'Mulai Trip Baru',
		parentHref: '/driver'
	},
	'/procurement': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Pengajuan Pembelian' }],
		title: 'Pengajuan Pembelian',
		parentHref: '/barang'
	},
	'/procurement/ajukan': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Pengajuan Pembelian', href: '/procurement' }, { label: 'Form Ajukan Beli' }],
		title: 'Form Ajukan Beli',
		parentHref: '/procurement'
	},
	'/procurement/approval': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Pengajuan Pembelian', href: '/procurement' }, { label: 'Approval Pembelian' }],
		title: 'Approval Pembelian',
		parentHref: '/procurement'
	},
	'/procurement/terima': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Pengajuan Pembelian', href: '/procurement' }, { label: 'Terima PO' }],
		title: 'Konfirmasi Terima PO',
		parentHref: '/procurement'
	},
	'/procurement/lacak': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Pengajuan Pembelian', href: '/procurement' }, { label: 'Lacak PO' }],
		title: 'Lacak Pengajuan Beli',
		parentHref: '/procurement'
	},
	'/field-report': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Inventory & Logistik', href: '/barang' }, { label: 'Field Material' }],
		title: 'Ringkasan Field Material',
		parentHref: '/barang'
	},

	// Departemen: Sales & Marketing
	'/sales/hub': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Sales & Marketing' }],
		title: 'Hub Sales & Marketing',
		parentHref: '/'
	},
	'/sales': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Sales & Marketing', href: '/sales/hub' }, { label: 'Log Kunjungan' }],
		title: 'Log Kunjungan Sales',
		parentHref: '/sales/hub'
	},
	'/sales/baru': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Sales & Marketing', href: '/sales/hub' }, { label: 'Log Kunjungan', href: '/sales' }, { label: 'Check-in Baru' }],
		title: 'Check-in Kunjungan Baru',
		parentHref: '/sales'
	},
	'/sales/po': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Sales & Marketing', href: '/sales/hub' }, { label: 'PO Customer' }],
		title: 'PO Customer',
		parentHref: '/sales/hub'
	},
	'/sales/prospek': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Sales & Marketing', href: '/sales/hub' }, { label: 'Pipeline Prospek' }],
		title: 'Pipeline Prospek Sales',
		parentHref: '/sales/hub'
	},
	'/sales/prospek/baru': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Sales & Marketing', href: '/sales/hub' }, { label: 'Pipeline Prospek', href: '/sales/prospek' }, { label: 'Lead Baru' }],
		title: 'Tambah Lead Prospek Baru',
		parentHref: '/sales/prospek'
	},
	'/sales/penawaran': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Sales & Marketing', href: '/sales/hub' }, { label: 'Kalkulator Penawaran' }],
		title: 'Kalkulator & Penawaran',
		parentHref: '/sales/hub'
	},
	'/sales/penawaran/baru': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Sales & Marketing', href: '/sales/hub' }, { label: 'Kalkulator Penawaran', href: '/sales/penawaran' }, { label: 'Buat Baru' }],
		title: 'Buat Penawaran Baru',
		parentHref: '/sales/penawaran'
	},
	'/sales/survey': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Sales & Marketing', href: '/sales/hub' }, { label: 'Survey Lokasi' }],
		title: 'Survey Lokasi Lapangan',
		parentHref: '/sales/hub'
	},
	'/sales/survey/baru': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Sales & Marketing', href: '/sales/hub' }, { label: 'Survey Lokasi', href: '/sales/survey' }, { label: 'Survey Baru' }],
		title: 'Input Survey Lapangan Baru',
		parentHref: '/sales/survey'
	},
	'/sales/laporan-harian': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Sales & Marketing', href: '/sales/hub' }, { label: 'Laporan Harian' }],
		title: 'Laporan Harian Sales',
		parentHref: '/sales/hub'
	},
	'/komplain-customer': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Sales & Marketing', href: '/sales/hub' }, { label: 'Komplain Customer' }],
		title: 'Lapor Komplain Customer',
		parentHref: '/sales/hub'
	},
	'/kemitraan': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Sales & Marketing', href: '/sales/hub' }, { label: 'Kemitraan & Atribusi' }],
		title: 'Kemitraan & Atribusi',
		parentHref: '/sales/hub'
	},
	'/kemitraan/evaluasi': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Sales & Marketing', href: '/sales/hub' }, { label: 'Kemitraan', href: '/kemitraan' }, { label: 'Evaluasi Mitra' }],
		title: 'Evaluasi Mitra',
		parentHref: '/kemitraan'
	},
	'/atribusi': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Sales & Marketing', href: '/sales/hub' }, { label: 'Kemitraan', href: '/kemitraan' }, { label: 'Atribusi Mitra' }],
		title: 'Atribusi Mitra Proyek',
		parentHref: '/kemitraan'
	},
	'/csr': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Sales & Marketing', href: '/sales/hub' }, { label: 'CSR & TJSL' }],
		title: 'CSR & TJSL',
		parentHref: '/sales/hub'
	},
	'/csr/kegiatan': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Sales & Marketing', href: '/sales/hub' }, { label: 'CSR & TJSL', href: '/csr' }, { label: 'Kegiatan CSR' }],
		title: 'Kegiatan CSR & TJSL',
		parentHref: '/csr'
	},
	'/csr/penerima': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Sales & Marketing', href: '/sales/hub' }, { label: 'CSR & TJSL', href: '/csr' }, { label: 'Penerima Manfaat' }],
		title: 'Penerima Manfaat CSR',
		parentHref: '/csr'
	},

	// Departemen: Produksi & R&D
	'/produksi/hub': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Produksi & R&D' }],
		title: 'Hub Produksi & R&D',
		parentHref: '/'
	},
	'/produksi': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Produksi & R&D', href: '/produksi/hub' }, { label: 'Monitoring Produksi' }],
		title: 'Monitoring Produksi',
		parentHref: '/produksi/hub'
	},
	'/produksi/input-harian': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Produksi & R&D', href: '/produksi/hub' }, { label: 'Input Produksi' }],
		title: 'Input Produksi Harian',
		parentHref: '/produksi/hub'
	},
	'/rnd': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Produksi & R&D', href: '/produksi/hub' }, { label: 'R&D — TDS/MSDS' }],
		title: 'R&D — TDS/MSDS',
		parentHref: '/produksi/hub'
	},

	// Departemen: HRD & GA
	'/hrga/hub': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'HRD & GA' }],
		title: 'Hub Departemen HRD & GA',
		parentHref: '/'
	},
	'/hrga': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'HRD & GA' }],
		title: 'Hub Departemen HRD & GA',
		parentHref: '/'
	},
	'/ga-checklist': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'HRD & GA', href: '/hrga/hub' }, { label: 'GA Checklist' }],
		title: 'GA Checklist (Fasilitas & K3)',
		parentHref: '/hrga/hub'
	},
	'/ga-request': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'HRD & GA', href: '/hrga/hub' }, { label: 'Permintaan GA' }],
		title: 'Permintaan Layanan & Fasilitas GA',
		parentHref: '/hrga/hub'
	},
	'/ruangan': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'HRD & GA', href: '/hrga/hub' }, { label: 'Barang per Ruangan' }],
		title: 'Barang per Ruangan',
		parentHref: '/hrga/hub'
	},
	'/ga-request/baru': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'HRD & GA', href: '/hrga/hub' }, { label: 'Permintaan GA', href: '/ga-request' }, { label: 'Baru' }],
		title: 'Form Permintaan Layanan GA',
		parentHref: '/ga-request'
	},
	'/satpam': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'HRD & GA', href: '/hrga/hub' }, { label: 'Satpam & Keamanan' }],
		title: 'Satpam & Keamanan',
		parentHref: '/hrga/hub'
	},
	'/satpam/gate': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'HRD & GA', href: '/hrga/hub' }, { label: 'Satpam', href: '/satpam' }, { label: 'Gate Log' }],
		title: 'Gate Log Satpam',
		parentHref: '/satpam'
	},
	'/satpam/patroli': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'HRD & GA', href: '/hrga/hub' }, { label: 'Satpam', href: '/satpam' }, { label: 'Patroli' }],
		title: 'Patroli Ronda Satpam',
		parentHref: '/satpam'
	},
	'/satpam/tamu': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'HRD & GA', href: '/hrga/hub' }, { label: 'Satpam', href: '/satpam' }, { label: 'Buku Tamu' }],
		title: 'Buku Tamu & Kendaraan',
		parentHref: '/satpam'
	},
	'/satpam/insiden': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'HRD & GA', href: '/hrga/hub' }, { label: 'Satpam', href: '/satpam' }, { label: 'Lapor Insiden' }],
		title: 'Lapor Insiden Keamanan',
		parentHref: '/satpam'
	},
	'/satpam/serah-terima': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'HRD & GA', href: '/hrga/hub' }, { label: 'Satpam', href: '/satpam' }, { label: 'Serah Terima' }],
		title: 'Serah Terima Jaga Satpam',
		parentHref: '/satpam'
	},
	'/satpam/deposit-hp': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'HRD & GA', href: '/hrga/hub' }, { label: 'Satpam', href: '/satpam' }, { label: 'Deposit HP' }],
		title: 'Penitipan / Deposit HP',
		parentHref: '/satpam'
	},
	'/fleet-booking': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'HRD & GA', href: '/hrga/hub' }, { label: 'Fleet Booking' }],
		title: 'Fleet Booking Kendaraan',
		parentHref: '/hrga/hub'
	},
	'/legal/hak-cipta': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'HRD & GA', href: '/hrga/hub' }, { label: 'Legal & Hak Cipta' }],
		title: 'Hak Cipta & Legalitas',
		parentHref: '/hrga/hub'
	},

	// Departemen: Portal Karyawan (ESS)
	'/ess': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'Portal Karyawan' }],
		title: 'Portal Karyawan',
		parentHref: '/'
	},
	'/site-checkin': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Site Check-in' }],
		title: 'Site Check-in Proyek',
		parentHref: '/ess'
	},
	'/ess/absen': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Absensi' }],
		title: 'Absensi Masuk / Pulang',
		parentHref: '/ess'
	},
	'/ess/kehadiran': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Kehadiran' }],
		title: 'Rekap Kehadiran',
		parentHref: '/ess'
	},
	'/ess/kalender': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Kalender Kerja' }],
		title: 'Kalender Kerja & Libur',
		parentHref: '/ess'
	},
	'/ess/disiplin': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Disiplin' }],
		title: 'Status Kehadiran & Disiplin',
		parentHref: '/ess'
	},
	'/ess/cuti': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Cuti Saya' }],
		title: 'Cuti Saya',
		parentHref: '/ess'
	},
	'/ess/cuti/baru': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Cuti', href: '/ess/cuti' }, { label: 'Pengajuan' }],
		title: 'Pengajuan Cuti Baru',
		parentHref: '/ess/cuti'
	},
	'/ess/izin-sakit': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Izin & Sakit' }],
		title: 'Izin / Sakit',
		parentHref: '/ess'
	},
	'/ess/izin-jam/baru': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Izin Per Jam' }],
		title: 'Izin Keluar Kantor Per Jam',
		parentHref: '/ess'
	},
	'/ess/lembur': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Lembur' }],
		title: 'Lembur Saya',
		parentHref: '/ess'
	},
	'/ess/lembur/baru': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Lembur', href: '/ess/lembur' }, { label: 'Pengajuan' }],
		title: 'Pengajuan Lembur',
		parentHref: '/ess/lembur'
	},
	'/ess/shift': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Shift' }],
		title: 'Jadwal Shift Kerja',
		parentHref: '/ess'
	},
	'/ess/keuangan': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Keuangan' }],
		title: 'Keuangan Saya',
		parentHref: '/ess'
	},
	'/ess/slip-gaji': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Slip Gaji' }],
		title: 'Slip Gaji Saya',
		parentHref: '/ess'
	},
	'/ess/kendaraan': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Peminjaman Kendaraan' }],
		title: 'Peminjaman Kendaraan Operasional',
		parentHref: '/ess'
	},
	'/ess/reimburse': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Reimbursement' }],
		title: 'Reimbursement',
		parentHref: '/ess'
	},
	'/ess/reimburse/baru': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Reimbursement', href: '/ess/reimburse' }, { label: 'Pengajuan Baru' }],
		title: 'Pengajuan Reimbursement Baru',
		parentHref: '/ess/reimburse'
	},
	'/ess/kasbon': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Kasbon' }],
		title: 'Kasbon Saya',
		parentHref: '/ess'
	},
	'/ess/kasbon/baru': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Kasbon', href: '/ess/kasbon' }, { label: 'Pengajuan' }],
		title: 'Pengajuan Kasbon',
		parentHref: '/ess/kasbon'
	},
	'/ess/approval': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Approval Atasan' }],
		title: 'Approval Atasan',
		parentHref: '/ess'
	},
	'/ess/pelatihan': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Pelatihan' }],
		title: 'Pelatihan & Kursus E-Learning',
		parentHref: '/ess'
	},
	'/ess/pelatihan/feedback': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Pelatihan', href: '/ess/pelatihan' }, { label: 'Feedback' }],
		title: 'Feedback Pelatihan',
		parentHref: '/ess/pelatihan'
	},
	'/ess/pelatihan/buku-saku': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Pelatihan', href: '/ess/pelatihan' }, { label: 'Buku Saku Cat' }],
		title: 'Buku Saku Cat',
		parentHref: '/ess/pelatihan'
	},
	'/ess/pelatihan/sop': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Pelatihan', href: '/ess/pelatihan' }, { label: 'SOP & Panduan' }],
		title: 'SOP & Panduan Kerja Perusahaan',
		parentHref: '/ess/pelatihan'
	},
	'/ess/pelatihan/tim': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Pelatihan', href: '/ess/pelatihan' }, { label: 'Monitoring Tim' }],
		title: 'Monitoring Pelatihan Tim',
		parentHref: '/ess/pelatihan'
	},
	'/ess/pengumuman': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Pengumuman' }],
		title: 'Pengumuman Perusahaan',
		parentHref: '/ess'
	},
	'/ess/kinerja': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Kinerja' }],
		title: 'Kinerja Saya',
		parentHref: '/ess'
	},
	'/ess/maintenance-kpi': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Kinerja', href: '/ess/kinerja' }, { label: 'KPI Maintenance' }],
		title: 'KPI Tim Maintenance',
		parentHref: '/ess/kinerja'
	},
	'/ess/penilaian-rekan': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Kinerja', href: '/ess/kinerja' }, { label: 'Penilaian Rekan' }],
		title: 'Penilaian Rekan Kerja (Peer Review)',
		parentHref: '/ess/kinerja'
	},
	'/ess/apresiasi-saya': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Apresiasi Saya' }],
		title: 'Apresiasi Saya',
		parentHref: '/ess'
	},
	'/ess/gamifikasi': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Poin & Badge' }],
		title: 'Poin & Badge Karyawan',
		parentHref: '/ess'
	},
	'/ess/dokumen-saya': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Dokumen Saya' }],
		title: 'Dokumen Karyawan',
		parentHref: '/ess'
	},
	'/ess/dokumen-request': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Minta Dokumen' }],
		title: 'Permintaan Dokumen Karyawan',
		parentHref: '/ess'
	},
	'/ess/sertifikasi': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Sertifikasi' }],
		title: 'Sertifikasi & Lisensi Karyawan',
		parentHref: '/ess'
	},
	'/ess/resign': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Pengunduran Diri' }],
		title: 'Pengajuan Pengunduran Diri',
		parentHref: '/ess'
	},
	'/ess/notes': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Catatan Saya' }],
		title: 'Catatan Saya',
		parentHref: '/ess'
	},
	'/ess/bookmarks': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Pintasan Saya' }],
		title: 'Pintasan Saya',
		parentHref: '/ess'
	},
	'/ess/profil': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Profil Saya' }],
		title: 'Profil Saya',
		parentHref: '/ess'
	},
	'/ess/admin': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Admin HRD' }],
		title: 'Admin HRD / Portal Karyawan',
		parentHref: '/ess'
	},
	'/ess/admin/face-enroll': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Admin HRD', href: '/ess/admin' }, { label: 'Face Enroll' }],
		title: 'Pendaftaran Wajah Karyawan',
		parentHref: '/ess/admin'
	},
	'/ess/onboarding': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Onboarding' }],
		title: 'Onboarding Karyawan',
		parentHref: '/ess'
	},
	'/ess/offboarding': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Offboarding' }],
		title: 'Offboarding Karyawan',
		parentHref: '/ess'
	},
	'/ess/mentor': {
		breadcrumb: [{ label: 'Portal Karyawan', href: '/ess' }, { label: 'Dashboard Mentor' }],
		title: 'Dashboard Mentor',
		parentHref: '/ess'
	},

	// Departemen: HSE & Mutu
	'/hse/hub': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'HSE & Mutu' }],
		title: 'Hub HSE & Mutu',
		parentHref: '/'
	},
	'/hse': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'HSE & Mutu', href: '/hse/hub' }, { label: 'Dashboard HSE' }],
		title: 'Dashboard HSE',
		parentHref: '/hse/hub'
	},
	'/hse/apd': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'HSE & Mutu', href: '/hse/hub' }, { label: 'Dashboard HSE', href: '/hse' }, { label: 'Stok APD' }],
		title: 'Inventaris APD',
		parentHref: '/hse'
	},
	'/hse/b3': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'HSE & Mutu', href: '/hse/hub' }, { label: 'Dashboard HSE', href: '/hse' }, { label: 'Limbah B3' }],
		title: 'Pengelolaan Limbah B3',
		parentHref: '/hse'
	},
	'/hse/inspeksi': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'HSE & Mutu', href: '/hse/hub' }, { label: 'Dashboard HSE', href: '/hse' }, { label: 'Inspeksi K3' }],
		title: 'Inspeksi K3 Proyek',
		parentHref: '/hse'
	},
	'/hse/izin-kerja': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'HSE & Mutu', href: '/hse/hub' }, { label: 'Dashboard HSE', href: '/hse' }, { label: 'Izin Kerja (PTW)' }],
		title: 'Izin Kerja Aman (PTW)',
		parentHref: '/hse'
	},
	'/hse/soc': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'HSE & Mutu', href: '/hse/hub' }, { label: 'Dashboard HSE', href: '/hse' }, { label: 'Kartu SOC' }],
		title: 'Safety Observation Card (SOC)',
		parentHref: '/hse'
	},
	'/hse/training-mcu': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'HSE & Mutu', href: '/hse/hub' }, { label: 'Dashboard HSE', href: '/hse' }, { label: 'Training & MCU' }],
		title: 'Training & MCU K3',
		parentHref: '/hse'
	},
	'/inspection': {
		breadcrumb: [{ label: 'Departemen' }, { label: 'HSE & Mutu', href: '/hse/hub' }, { label: 'Inspection Report' }],
		title: 'Inspection Report (BPIR)',
		parentHref: '/hse/hub'
	},

	// Dokumen & SOP
	'/bantuan': {
		breadcrumb: [{ label: 'Dokumen & SOP' }, { label: 'Bantuan' }],
		title: 'Bantuan Untuk Anda',
		parentHref: '/'
	},
	'/panduan': {
		breadcrumb: [{ label: 'Dokumen & SOP' }, { label: 'Panduan Lengkap' }],
		title: 'Panduan & SOP',
		parentHref: '/'
	}
};

export function getBreadcrumbAndTitle(pathname: string): BreadcrumbResult {
	if (!pathname) {
		return {
			breadcrumb: [{ label: 'Beranda', href: '/' }],
			title: 'Beranda',
			parentHref: '/'
		};
	}

	// 1. Bersihkan query params dan hash
	let cleanPath = pathname.split('?')[0].split('#')[0].trim();

	// 2. Bersihkan prefix Windows drive letter atau URL file jika ada (e.g. /A:, A:, /C:, C:)
	cleanPath = cleanPath.replace(/^\/?[a-zA-Z]:(?:\/|\\)?/, '/');

	// 3. Bersihkan prefix SvelteKit route groups seperti /(app)/ atau (app)/
	cleanPath = cleanPath.replace(/^\/?\([^)]+\)/, '');

	// 4. Normalisasi slash & trailing slash
	cleanPath = cleanPath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '') || '/';
	if (!cleanPath.startsWith('/')) {
		cleanPath = '/' + cleanPath;
	}

	if (STATIC_ROUTE_MAP[cleanPath]) {
		return STATIC_ROUTE_MAP[cleanPath];
	}

	// Dynamic route patterns: Proyek
	if (cleanPath.startsWith('/proyek/')) {
		const parts = cleanPath.split('/').filter(Boolean); // ['proyek', id, ...]
		const projectId = parts[1];

		if (parts.length === 2) {
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Project', href: '/proyek/hub' },
					{ label: 'List Project', href: '/proyek' },
					{ label: 'Detail Proyek' }
				],
				title: 'Detail Proyek',
				parentHref: '/proyek'
			};
		}

		const sub = parts[2];
		const projectBaseHref = `/proyek/${projectId}`;

		if (sub === 'hse-dok') {
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Project', href: '/proyek/hub' },
					{ label: 'List Project', href: '/proyek' },
					{ label: 'Detail Proyek', href: projectBaseHref },
					{ label: 'Dokumen HSE' }
				],
				title: 'Dokumen HSE Proyek',
				parentHref: projectBaseHref
			};
		}

		if (sub === 'ringkasan') {
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Project', href: '/proyek/hub' },
					{ label: 'List Project', href: '/proyek' },
					{ label: 'Detail Proyek', href: projectBaseHref },
					{ label: 'Ringkasan Bulanan' }
				],
				title: 'Ringkasan Proyek',
				parentHref: projectBaseHref
			};
		}

		if (sub === 'punch-list') {
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Project', href: '/proyek/hub' },
					{ label: 'List Project', href: '/proyek' },
					{ label: 'Detail Proyek', href: projectBaseHref },
					{ label: 'Punch List' }
				],
				title: 'Punch List Proyek',
				parentHref: projectBaseHref
			};
		}

		if (sub === 'rfi') {
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Project', href: '/proyek/hub' },
					{ label: 'List Project', href: '/proyek' },
					{ label: 'Detail Proyek', href: projectBaseHref },
					{ label: 'RFI' }
				],
				title: 'RFI Proyek',
				parentHref: projectBaseHref
			};
		}

		if (sub === 'itp') {
			if (parts.length > 3) {
				return {
					breadcrumb: [
						{ label: 'Departemen' },
						{ label: 'Project', href: '/proyek/hub' },
						{ label: 'List Project', href: '/proyek' },
						{ label: 'Detail Proyek', href: projectBaseHref },
						{ label: 'ITP', href: `${projectBaseHref}/itp` },
						{ label: 'Detail ITP' }
					],
					title: 'Detail ITP Proyek',
					parentHref: `${projectBaseHref}/itp`
				};
			}
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Project', href: '/proyek/hub' },
					{ label: 'List Project', href: '/proyek' },
					{ label: 'Detail Proyek', href: projectBaseHref },
					{ label: 'ITP' }
				],
				title: 'ITP Proyek',
				parentHref: projectBaseHref
			};
		}

		if (sub === 'site-survey') {
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Project', href: '/proyek/hub' },
					{ label: 'List Project', href: '/proyek' },
					{ label: 'Detail Proyek', href: projectBaseHref },
					{ label: 'Site Survey' }
				],
				title: 'Site Survey Proyek',
				parentHref: projectBaseHref
			};
		}

		if (sub === 'quality') {
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Project', href: '/proyek/hub' },
					{ label: 'List Project', href: '/proyek' },
					{ label: 'Detail Proyek', href: projectBaseHref },
					{ label: 'Quality Cockpit' }
				],
				title: 'Quality Cockpit Proyek',
				parentHref: projectBaseHref
			};
		}

		if (sub === 'material-inspection') {
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Project', href: '/proyek/hub' },
					{ label: 'List Project', href: '/proyek' },
					{ label: 'Detail Proyek', href: projectBaseHref },
					{ label: 'Material Inspection' }
				],
				title: 'Material Inspection',
				parentHref: projectBaseHref
			};
		}

		if (sub === 'coating-log') {
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Project', href: '/proyek/hub' },
					{ label: 'List Project', href: '/proyek' },
					{ label: 'Detail Proyek', href: projectBaseHref },
					{ label: 'Coating Log' }
				],
				title: 'Coating Log Proyek',
				parentHref: projectBaseHref
			};
		}

		if (sub === 'closeout') {
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Project', href: '/proyek/hub' },
					{ label: 'List Project', href: '/proyek' },
					{ label: 'Detail Proyek', href: projectBaseHref },
					{ label: 'Checklist Closeout' }
				],
				title: 'Checklist Closeout Proyek',
				parentHref: projectBaseHref
			};
		}

		if (sub === 'presentasi') {
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Project', href: '/proyek/hub' },
					{ label: 'List Project', href: '/proyek' },
					{ label: 'Detail Proyek', href: projectBaseHref },
					{ label: 'Mode Presentasi' }
				],
				title: 'Mode Presentasi Proyek',
				parentHref: projectBaseHref
			};
		}

		return {
			breadcrumb: [
				{ label: 'Departemen' },
				{ label: 'Project', href: '/proyek/hub' },
				{ label: 'List Project', href: '/proyek' },
				{ label: 'Detail Proyek', href: projectBaseHref },
				{ label: sub.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) }
			],
			title: 'Detail Proyek',
			parentHref: projectBaseHref
		};
	}

	// Dynamic route: Barang per Ruangan (Barang per Ruangan via QR Patroli, Fase 2)
	if (cleanPath.startsWith('/ruangan/')) {
		return {
			breadcrumb: [
				{ label: 'Departemen' },
				{ label: 'HRD & GA', href: '/hrga/hub' },
				{ label: 'Barang per Ruangan', href: '/ruangan' },
				{ label: 'Detail Ruangan' }
			],
			title: 'Barang per Ruangan',
			parentHref: '/ruangan'
		};
	}

	// Dynamic route: Anggaran
	if (cleanPath.startsWith('/anggaran/')) {
		const parts = cleanPath.split('/').filter(Boolean);
		const id = parts[1];
		if (parts.includes('edit')) {
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Project', href: '/proyek/hub' },
					{ label: 'Keuangan & Anggaran', href: '/anggaran' },
					{ label: 'Detail Anggaran', href: `/anggaran/${id}` },
					{ label: 'Edit' }
				],
				title: 'Edit Pengajuan Anggaran',
				parentHref: `/anggaran/${id}`
			};
		}
		return {
			breadcrumb: [
				{ label: 'Departemen' },
				{ label: 'Project', href: '/proyek/hub' },
				{ label: 'Keuangan & Anggaran', href: '/anggaran' },
				{ label: 'Detail Anggaran' }
			],
			title: 'Detail Pengajuan Anggaran',
			parentHref: '/anggaran'
		};
	}

	// Dynamic route: Laporan
	if (cleanPath.startsWith('/laporan/')) {
		return {
			breadcrumb: [
				{ label: 'Departemen' },
				{ label: 'Project', href: '/proyek/hub' },
				{ label: 'Laporan Harian', href: '/laporan' },
				{ label: 'Input Laporan' }
			],
			title: 'Laporan Harian Proyek',
			parentHref: '/laporan'
		};
	}

	// Dynamic route: Timeline
	if (cleanPath.startsWith('/timeline/')) {
		return {
			breadcrumb: [
				{ label: 'Departemen' },
				{ label: 'Project', href: '/proyek/hub' },
				{ label: 'Timeline & Jadwal', href: '/timeline' },
				{ label: 'Detail Timeline' }
			],
			title: 'Timeline Proyek',
			parentHref: '/timeline'
		};
	}

	// Dynamic route: Packing List
	if (cleanPath.startsWith('/packing-list/')) {
		const parts = cleanPath.split('/').filter(Boolean);
		const id = parts[1];
		if (parts.includes('pick')) {
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Project', href: '/proyek/hub' },
					{ label: 'Packing List', href: '/packing-list' },
					{ label: 'Detail', href: `/packing-list/${id}` },
					{ label: 'Picking Barcode' }
				],
				title: 'Picking Packing List',
				parentHref: `/packing-list/${id}`
			};
		}
		return {
			breadcrumb: [
				{ label: 'Departemen' },
				{ label: 'Project', href: '/proyek/hub' },
				{ label: 'Packing List', href: '/packing-list' },
				{ label: 'Detail' }
			],
			title: 'Detail Packing List',
			parentHref: '/packing-list'
		};
	}

	// Dynamic route: JSA
	if (cleanPath.startsWith('/jsa/')) {
		return {
			breadcrumb: [
				{ label: 'Departemen' },
				{ label: 'HSE & Mutu', href: '/hse/hub' },
				{ label: 'Dashboard HSE', href: '/hse' },
				{ label: 'JSA' }
			],
			title: 'JSA (Job Safety Analysis)',
			parentHref: '/hse'
		};
	}

	// Dynamic route: Toolbox
	if (cleanPath.startsWith('/toolbox/')) {
		return {
			breadcrumb: [
				{ label: 'Departemen' },
				{ label: 'HSE & Mutu', href: '/hse/hub' },
				{ label: 'Dashboard HSE', href: '/hse' },
				{ label: 'Toolbox Meeting' }
			],
			title: 'Toolbox Meeting Proyek',
			parentHref: '/hse'
		};
	}

	// Dynamic route: Inspection
	if (cleanPath.startsWith('/inspection/')) {
		return {
			breadcrumb: [
				{ label: 'Departemen' },
				{ label: 'HSE & Mutu', href: '/hse/hub' },
				{ label: 'Inspection Report', href: '/inspection' },
				{ label: 'Detail BPIR' }
			],
			title: 'Detail BPIR Inspection',
			parentHref: '/inspection'
		};
	}

	// Dynamic route: GA Checklist
	if (cleanPath.startsWith('/ga-checklist/')) {
		return {
			breadcrumb: [
				{ label: 'Departemen' },
				{ label: 'HRD & GA', href: '/hrga/hub' },
				{ label: 'GA Checklist', href: '/ga-checklist' },
				{ label: 'Isi Form' }
			],
			title: 'Form GA Checklist',
			parentHref: '/ga-checklist'
		};
	}

	// Dynamic route: Driver Trip
	if (cleanPath.startsWith('/driver/trip/')) {
		return {
			breadcrumb: [
				{ label: 'Departemen' },
				{ label: 'Inventory & Logistik', href: '/barang' },
				{ label: 'Driver App', href: '/driver' },
				{ label: 'Detail Trip' }
			],
			title: 'Detail Trip Logistik',
			parentHref: '/driver'
		};
	}

	// Dynamic route: Requisition
	if (cleanPath.startsWith('/requisition/')) {
		return {
			breadcrumb: [
				{ label: 'Departemen' },
				{ label: 'Inventory & Logistik', href: '/barang' },
				{ label: 'Requisition', href: '/requisition' },
				{ label: 'Detail Requisition' }
			],
			title: 'Detail Requisition Proyek',
			parentHref: '/requisition'
		};
	}

	// Dynamic route: SJI
	if (cleanPath.startsWith('/sji/')) {
		const parts = cleanPath.split('/').filter(Boolean);
		if (cleanPath.includes('/peminjaman/') && cleanPath.endsWith('/kembali')) {
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Inventory & Logistik', href: '/barang' },
					{ label: 'Surat Jalan Internal', href: '/sji' },
					{ label: 'Pengembalian Peminjaman' }
				],
				title: 'Pengembalian Peminjaman SJI',
				parentHref: '/sji'
			};
		}
		return {
			breadcrumb: [
				{ label: 'Departemen' },
				{ label: 'Inventory & Logistik', href: '/barang' },
				{ label: 'Surat Jalan Internal', href: '/sji' },
				{ label: 'Detail SJI' }
			],
			title: 'Detail Surat Jalan Internal',
			parentHref: '/sji'
		};
	}

	// Dynamic route: SJ Manual
	if (cleanPath.startsWith('/sj-manual/')) {
		return {
			breadcrumb: [
				{ label: 'Departemen' },
				{ label: 'Inventory & Logistik', href: '/barang' },
				{ label: 'Surat Jalan Manual', href: '/sj-manual' },
				{ label: 'Detail SJ Manual' }
			],
			title: 'Detail Surat Jalan Manual',
			parentHref: '/sj-manual'
		};
	}

	// Dynamic route: Stock Lapangan
	if (cleanPath.startsWith('/stock-lapangan/')) {
		const parts = cleanPath.split('/').filter(Boolean);
		if (cleanPath.startsWith('/stock-lapangan/antrian/')) {
			const id = parts[2];
			if (parts.includes('pick')) {
				return {
					breadcrumb: [
						{ label: 'Departemen' },
						{ label: 'Inventory & Logistik', href: '/barang' },
						{ label: 'Stok Lapangan', href: '/stock-lapangan' },
						{ label: 'Antrian', href: '/stock-lapangan/antrian' },
						{ label: 'Detail', href: `/stock-lapangan/antrian/${id}` },
						{ label: 'Picking Barcode' }
					],
					title: 'Picking Antrian Stok',
					parentHref: `/stock-lapangan/antrian/${id}`
				};
			}
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Inventory & Logistik', href: '/barang' },
					{ label: 'Stok Lapangan', href: '/stock-lapangan' },
					{ label: 'Antrian', href: '/stock-lapangan/antrian' },
					{ label: 'Detail Antrian' }
				],
				title: 'Detail Antrian Pengeluaran',
				parentHref: '/stock-lapangan/antrian'
			};
		}

		if (cleanPath.startsWith('/stock-lapangan/cek-area/')) {
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Inventory & Logistik', href: '/barang' },
					{ label: 'Stok Lapangan', href: '/stock-lapangan' },
					{ label: 'Cek Area', href: '/stock-lapangan/cek-area' },
					{ label: 'Detail Gudang' }
				],
				title: 'Detail Area Gudang',
				parentHref: '/stock-lapangan/cek-area'
			};
		}
	}

	// Dynamic route: Maintenance & Bengkel
	if (cleanPath.startsWith('/maintenance/')) {
		if (cleanPath.startsWith('/maintenance/work-order/')) {
			const parts = cleanPath.split('/').filter(Boolean);
			const id = parts[2];
			if (parts.includes('lapor')) {
				return {
					breadcrumb: [
						{ label: 'Departemen' },
						{ label: 'Maintenance & Bengkel', href: '/perawatan' },
						{ label: 'Work Order', href: '/maintenance/work-order' },
						{ label: 'Detail WO', href: `/maintenance/work-order/${id}` },
						{ label: 'Lapor Pengerjaan' }
					],
					title: 'Lapor Pengerjaan WO',
					parentHref: `/maintenance/work-order/${id}`
				};
			}
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Maintenance & Bengkel', href: '/perawatan' },
					{ label: 'Work Order', href: '/maintenance/work-order' },
					{ label: 'Detail Work Order' }
				],
				title: 'Detail Work Order',
				parentHref: '/maintenance/work-order'
			};
		}

		if (cleanPath.startsWith('/maintenance/pinjaman-saya/')) {
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Maintenance & Bengkel', href: '/perawatan' },
					{ label: 'Pinjaman Saya', href: '/maintenance/pinjaman-saya' },
					{ label: 'Detail Pinjaman' }
				],
				title: 'Detail Pinjaman Alat',
				parentHref: '/maintenance/pinjaman-saya'
			};
		}
	}

	// Dynamic route: Preventive
	if (cleanPath.startsWith('/preventive/')) {
		const parts = cleanPath.split('/').filter(Boolean);
		const sub = parts[1];
		if (sub === 'p2h') {
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Maintenance & Bengkel', href: '/perawatan' },
					{ label: 'Preventive', href: '/preventive' },
					{ label: 'P2H Harian' }
				],
				title: 'Pemeriksaan Harian (P2H)',
				parentHref: '/preventive'
			};
		}
		if (sub === 'pm') {
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Maintenance & Bengkel', href: '/perawatan' },
					{ label: 'Preventive', href: '/preventive' },
					{ label: 'Servis Berkala' }
				],
				title: 'Preventive Maintenance (PM)',
				parentHref: '/preventive'
			};
		}
		if (sub === 'riwayat') {
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Maintenance & Bengkel', href: '/perawatan' },
					{ label: 'Preventive', href: '/preventive' },
					{ label: 'Riwayat Servis' }
				],
				title: 'Riwayat Servis Alat',
				parentHref: '/preventive'
			};
		}
	}

	// Dynamic route: Support
	if (cleanPath.startsWith('/support/')) {
		return {
			breadcrumb: [
				{ label: 'Departemen' },
				{ label: 'Maintenance & Bengkel', href: '/perawatan' },
				{ label: 'Support Lapangan', href: '/support' },
				{ label: 'Detail Tiket' }
			],
			title: 'Detail Tiket Support',
			parentHref: '/support'
		};
	}

	// Dynamic routes: Sales & Marketing
	if (cleanPath.startsWith('/sales/')) {
		const parts = cleanPath.split('/').filter(Boolean);
		const sub = parts[1];

		if (sub === 'po' && parts.length > 2) {
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Sales & Marketing', href: '/sales/hub' },
					{ label: 'PO Customer', href: '/sales/po' },
					{ label: 'Unggah Dokumen PO' }
				],
				title: 'Unggah Dokumen PO',
				parentHref: '/sales/po'
			};
		}

		if (sub === 'penawaran' && parts.length > 2) {
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Sales & Marketing', href: '/sales/hub' },
					{ label: 'Kalkulator Penawaran', href: '/sales/penawaran' },
					{ label: 'Edit Penawaran' }
				],
				title: 'Edit Penawaran Harga',
				parentHref: '/sales/penawaran'
			};
		}

		if (sub === 'prospek' && parts.length > 2) {
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Sales & Marketing', href: '/sales/hub' },
					{ label: 'Pipeline Prospek', href: '/sales/prospek' },
					{ label: 'Detail Lead' }
				],
				title: 'Detail Lead & Follow-up',
				parentHref: '/sales/prospek'
			};
		}

		if (sub === 'survey' && parts.length > 2) {
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Sales & Marketing', href: '/sales/hub' },
					{ label: 'Survey Lokasi', href: '/sales/survey' },
					{ label: 'Detail Survey' }
				],
				title: 'Detail Survey Lapangan',
				parentHref: '/sales/survey'
			};
		}

		if (sub === 'customer' && parts.length > 2) {
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Sales & Marketing', href: '/sales/hub' },
					{ label: 'Log Kunjungan', href: '/sales' },
					{ label: 'Histori Customer' }
				],
				title: 'Histori & CRM Customer',
				parentHref: '/sales'
			};
		}

		// /sales/[id] (Detail Kunjungan)
		if (parts.length === 2 && !['hub', 'baru', 'po', 'prospek', 'penawaran', 'survey', 'laporan-harian', 'customer'].includes(sub)) {
			return {
				breadcrumb: [
					{ label: 'Departemen' },
					{ label: 'Sales & Marketing', href: '/sales/hub' },
					{ label: 'Log Kunjungan', href: '/sales' },
					{ label: 'Detail Kunjungan' }
				],
				title: 'Detail Kunjungan Sales',
				parentHref: '/sales'
			};
		}
	}

	// Dynamic routes: ESS
	if (cleanPath.startsWith('/ess/')) {
		const parts = cleanPath.split('/').filter(Boolean);
		const sub = parts[1];

		if (sub === 'dokumen-saya' && cleanPath.endsWith('/ttd')) {
			return {
				breadcrumb: [
					{ label: 'Portal Karyawan', href: '/ess' },
					{ label: 'Dokumen Saya', href: '/ess/dokumen-saya' },
					{ label: 'Tanda Tangan' }
				],
				title: 'Tanda Tangan Dokumen Digital',
				parentHref: '/ess/dokumen-saya'
			};
		}

		if (sub === 'kendaraan' && cleanPath.includes('/checklist/')) {
			return {
				breadcrumb: [
					{ label: 'Portal Karyawan', href: '/ess' },
					{ label: 'Peminjaman Kendaraan', href: '/ess/kendaraan' },
					{ label: 'Checklist' }
				],
				title: 'Checklist Peminjaman Kendaraan',
				parentHref: '/ess/kendaraan'
			};
		}

		if (sub === 'pelatihan') {
			if (cleanPath.startsWith('/ess/pelatihan/sop/')) {
				return {
					breadcrumb: [
						{ label: 'Portal Karyawan', href: '/ess' },
						{ label: 'Pelatihan', href: '/ess/pelatihan' },
						{ label: 'SOP & Panduan', href: '/ess/pelatihan/sop' },
						{ label: 'Detail SOP' }
					],
					title: 'Detail SOP Kerja Perusahaan',
					parentHref: '/ess/pelatihan/sop'
				};
			}

			if (parts.length === 3 && !['feedback', 'sop', 'tim'].includes(parts[2])) {
				return {
					breadcrumb: [
						{ label: 'Portal Karyawan', href: '/ess' },
						{ label: 'Pelatihan', href: '/ess/pelatihan' },
						{ label: 'Modul Kursus' }
					],
					title: 'Modul Pelatihan E-Learning',
					parentHref: '/ess/pelatihan'
				};
			}
		}
	}

	// Fallback formatter
	const rawSegments = cleanPath.split('/').filter(Boolean);
	const validSegments = rawSegments.filter((s) => !/^[a-zA-Z]:$/i.test(s) && !/^\([^)]+\)$/.test(s));
	const formattedSegments = validSegments.map((s) => ({
		label: s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
	}));

	if (formattedSegments.length === 0) {
		return {
			breadcrumb: [{ label: 'Beranda', href: '/' }],
			title: 'Beranda',
			parentHref: '/'
		};
	}

	return {
		breadcrumb: [{ label: 'Beranda', href: '/' }, ...formattedSegments],
		title: formattedSegments[formattedSegments.length - 1]?.label || 'Beranda',
		parentHref: validSegments.length > 1 ? `/${validSegments.slice(0, -1).join('/')}` : '/'
	};
}
