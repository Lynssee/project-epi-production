// src/lib/data/fieldNavConfig.ts
// Katalog navigasi menu & fitur lengkap Dashboard Lapangan (project-epi).
// Diindeks client-side oleh GlobalSearchModal (Ctrl+K) agar dapat dicari instan,
// mendukung typo tolerance, pencarian sinonim, dan tetap jalan offline.

export interface FieldNavItem {
	id: string;
	title: string;
	parent: string;
	href: string;
	icon?: string;
	permissions?: string[];
	keywords: string;
}

export const FIELD_NAV_ITEMS: FieldNavItem[] = [
	// ── Utama & Akses Cepat ──
	{
		id: 'home',
		title: 'Beranda Lapangan',
		parent: 'Akses Cepat',
		href: '/',
		icon: 'home',
		keywords: 'beranda home dashboard utama lapangan ringkasan status'
	},
	{
		id: 'command-center',
		title: 'Executive Command Center',
		parent: 'Akses Cepat',
		href: '/command-center',
		icon: 'dashboard',
		keywords: 'command center monitoring cctv radar status proyek operasional kendali'
	},
	{
		id: 'pusat-pengajuan',
		title: 'Pusat Pengajuan',
		parent: 'Akses Cepat',
		href: '/pusat-pengajuan',
		icon: 'hourglass',
		permissions: ['access_ess', 'access_requisition', 'manage_packing'],
		keywords: 'pusat pengajuan form permohonan dana kasbon pembelian barang operasional request'
	},
	{
		id: 'pusat-draf',
		title: 'Pusat Draf Tersimpan',
		parent: 'Akses Cepat',
		href: '/pusat-draf',
		icon: 'folder',
		keywords: 'pusat draf tersimpan draft simpan offline resume permohonan antrian'
	},
	{
		id: 'omnichannel',
		title: 'Omnichannel Chat Lapangan',
		parent: 'Akses Cepat',
		href: '/omnichannel',
		icon: 'message',
		keywords: 'omnichannel chat pesan whatsapp wa internal komunikasi tim inbox'
	},
	{
		id: 'scan-qr',
		title: 'Scan QR & Barcode',
		parent: 'Akses Cepat',
		href: '/scan',
		icon: 'qrcode',
		keywords: 'scan qr barcode kamera scanner cek resi surat jalan serial number equipment'
	},

	// ── Portal Karyawan (ESS & Absensi) ──
	{
		id: 'ess-beranda',
		title: 'Beranda ESS',
		parent: 'Portal Karyawan',
		href: '/ess',
		permissions: ['access_ess'],
		keywords: 'ess portal karyawan profil biodata dashboard pegawai'
	},
	{
		id: 'ess-absen',
		title: 'Absensi Masuk / Pulang',
		parent: 'Portal Karyawan',
		href: '/ess/absen',
		permissions: ['access_ess'],
		keywords: 'absen absensi masuk pulang clock in clock out selfie foto lokasi gps kehadiran disiplin'
	},
	{
		id: 'site-checkin',
		title: 'Site Check-in Proyek',
		parent: 'Portal Karyawan',
		href: '/site-checkin',
		permissions: ['access_site_checkin'],
		keywords: 'site checkin check in lokasi proyek lapangan hadir kerja kunjungan site gps geofence'
	},
	{
		id: 'ess-cuti',
		title: 'Cuti & Izin Saya',
		parent: 'Portal Karyawan',
		href: '/ess/cuti',
		permissions: ['access_ess'],
		keywords: 'cuti tahunan izin tidak masuk izin dinas saldo cuti pengajuan cuti form izin'
	},
	{
		id: 'ess-izin-sakit',
		title: 'Izin Sakit & Surat Dokter',
		parent: 'Portal Karyawan',
		href: '/ess/izin-sakit',
		permissions: ['access_ess'],
		keywords: 'izin sakit surat dokter mc medical certificate istirahat sakit klinik berobat'
	},
	{
		id: 'ess-izin-jam',
		title: 'Izin Per Jam / Keluar Kantor',
		parent: 'Portal Karyawan',
		href: '/ess/izin-jam',
		permissions: ['access_ess'],
		keywords: 'izin per jam keluar kantor urusan pribadi dispensasi waktu keterlambatan'
	},
	{
		id: 'ess-lembur',
		title: 'Lembur & Shift Kerja',
		parent: 'Portal Karyawan',
		href: '/ess/lembur',
		permissions: ['access_ess'],
		keywords: 'lembur shift spl surat perintah lembur jam kerja tambahan over time overtime lemburan'
	},
	{
		id: 'ess-kendaraan',
		title: 'Peminjaman Kendaraan ESS',
		parent: 'Portal Karyawan',
		href: '/ess/kendaraan',
		permissions: ['access_fleet_booking'],
		keywords: 'peminjaman kendaraan booking mobil motor operasional kantor pinjam armada mobil dinas'
	},
	{
		id: 'ess-keuangan',
		title: 'Keuangan, Slip Gaji & Kasbon',
		parent: 'Portal Karyawan',
		href: '/ess/keuangan',
		permissions: ['access_ess'],
		keywords: 'keuangan saya slip gaji payroll kasbon pinjaman insentif bonus transferan'
	},
	{
		id: 'ess-pelatihan',
		title: 'Pelatihan E-Learning',
		parent: 'Portal Karyawan',
		href: '/ess/pelatihan',
		permissions: ['access_ess'],
		keywords: 'pelatihan e-learning training kursus modul belajar video kompetensi sertifikat'
	},
	{
		id: 'ess-kinerja',
		title: 'Kinerja, Poin & Gamifikasi',
		parent: 'Portal Karyawan',
		href: '/ess/kinerja',
		permissions: ['access_ess'],
		keywords: 'kinerja kpi poin badge gamifikasi reward peringkat skor prestasi rapor kerja'
	},
	{
		id: 'ess-dokumen-saya',
		title: 'Dokumen Karyawan & Permintaan',
		parent: 'Portal Karyawan',
		href: '/ess/dokumen-saya',
		permissions: ['access_ess'],
		keywords: 'dokumen karyawan ktp npwp bpjs sertifikat minta surat keterangan kerja paklaring'
	},
	{
		id: 'sji',
		title: 'Surat Jalan Internal (SJI)',
		parent: 'Portal Karyawan',
		href: '/sji',
		permissions: ['access_ess', 'view_sji', 'input_sji'],
		keywords: 'sji surat jalan internal pinjam bawa alat lapangan inventaris serah terima barang'
	},
	{
		id: 'sj-manual',
		title: 'Surat Jalan Manual',
		parent: 'Portal Karyawan',
		href: '/sj-manual',
		permissions: ['access_ess', 'view_sji', 'input_sji'],
		keywords: 'sj manual surat jalan manual darurat pengiriman barang tanpa spk form manual nota kirim'
	},
	{
		id: 'ess-pengumuman',
		title: 'Pengumuman Perusahaan',
		parent: 'Portal Karyawan',
		href: '/ess/pengumuman',
		permissions: ['access_ess'],
		keywords: 'pengumuman berita edaran memo internal kabar kantor kabar direksi hari libur'
	},

	// ── Project & Proyek Lapangan ──
	{
		id: 'proyek-hub',
		title: 'Hub Project',
		parent: 'Project Lapangan',
		href: '/proyek/hub',
		permissions: ['view_all_projects', 'view_own_projects'],
		keywords: 'hub project manajemen proyek menu proyek pusat kontrol proyek lapangan'
	},
	{
		id: 'proyek-list',
		title: 'Daftar Proyek (List Project)',
		parent: 'Project Lapangan',
		href: '/proyek',
		permissions: ['view_all_projects', 'view_own_projects'],
		keywords: 'list project daftar proyek proyek aktif selesai lokasi leader spk po'
	},
	{
		id: 'proyek-workshop',
		title: 'Workshop Ops (Ciketing & Balaraja)',
		parent: 'Project Lapangan',
		href: '/workshop',
		permissions: ['view_all_projects', 'view_own_projects'],
		keywords: 'workshop ops ciketing balaraja bengkel fabrikasi sandblasting painting perbaikan spk'
	},
	{
		id: 'pengiriman-workshop',
		title: 'Pengiriman Workshop',
		parent: 'Project Lapangan',
		href: '/pengiriman-workshop',
		permissions: ['view_all_projects', 'view_own_projects'],
		keywords: 'pengiriman workshop kirim barang barang jadi dari bengkel ke site ekspedisi'
	},
	{
		id: 'mutasi-barang',
		title: 'Mutasi Barang Antar Proyek',
		parent: 'Project Lapangan',
		href: '/mutasi-barang',
		permissions: ['view_all_projects', 'view_own_projects'],
		keywords: 'mutasi barang transfer barang antar proyek pindah stok kirim material ke proyek lain'
	},
	{
		id: 'laporan-harian',
		title: 'Laporan Harian Proyek',
		parent: 'Project Lapangan',
		href: '/laporan',
		permissions: ['input_laporan', 'approve_laporan'],
		keywords: 'laporan harian proyek daily report progress cuaca tenaga kerja material kendala foto site'
	},
	{
		id: 'leader-regu',
		title: 'Leader & Regu Lapangan',
		parent: 'Project Lapangan',
		href: '/leader',
		permissions: ['view_all_projects', 'view_own_projects'],
		keywords: 'leader regu mandor pengawas foreman tim kerja pembagian kelompok shift'
	},
	{
		id: 'timeline-jadwal',
		title: 'Timeline & Jadwal Proyek',
		parent: 'Project Lapangan',
		href: '/timeline',
		permissions: ['view_all_projects', 'view_own_projects'],
		keywords: 'timeline jadwal kurva s gantt chart milestone adendum keterlambatan target selesai'
	},
	{
		id: 'keuangan-anggaran',
		title: 'Keuangan & Anggaran Proyek',
		parent: 'Project Lapangan',
		href: '/anggaran',
		permissions: ['request_budget', 'approve_budget'],
		keywords: 'anggaran biaya proyek budget pagu kasbon pengeluaran rap realisasi'
	},
	{
		id: 'biaya-lapangan',
		title: 'Biaya Lapangan (Reimburse & Nota)',
		parent: 'Project Lapangan',
		href: '/biaya-lapangan',
		permissions: ['access_ess'],
		keywords: 'biaya lapangan reimburse kasbon pengeluaran nota struk bensin tol konsumsi operasional'
	},
	{
		id: 'rap-aktual',
		title: 'RAP vs Realisasi Proyek',
		parent: 'Project Lapangan',
		href: '/rap-aktual',
		permissions: ['view_rap'],
		keywords: 'rap aktual realisasi margin deviasi selisih untung rugi rencana anggaran proyek'
	},
	{
		id: 'rap-terpusat',
		title: 'RAP & Realisasi Terpusat',
		parent: 'Project Lapangan',
		href: '/rap-aktual/terpusat',
		permissions: ['view_rap'],
		keywords: 'rap terpusat rekap semua proyek perbandingan anggaran portfolio performa biaya'
	},
	{
		id: 'kontrak-terpusat',
		title: 'Kontrak Jatuh Tempo',
		parent: 'Project Lapangan',
		href: '/kontrak-terpusat',
		permissions: ['view_all_projects', 'view_own_projects'],
		keywords: 'kontrak terpusat jatuh tempo masa berlaku pks spk perpanjangan kontrak vendor client'
	},
	{
		id: 'spk-terpusat',
		title: 'SPK Jatuh Tempo',
		parent: 'Project Lapangan',
		href: '/spk-terpusat',
		permissions: ['view_all_projects', 'view_own_projects', 'view_manpower'],
		keywords: 'spk terpusat surat perintah kerja borongan masa berlaku surat tugas subkon'
	},
	{
		id: 'manpower-rencana-realisasi',
		title: 'Manpower Rencana vs Realisasi',
		parent: 'Project Lapangan',
		href: '/manpower-rencana-realisasi',
		permissions: ['view_all_projects', 'view_own_projects', 'view_manpower'],
		keywords: 'manpower rencana realisasi alokasi pekerja headcount mandor tukang helper kekurangan orang'
	},
	{
		id: 'manpower-dobel-override',
		title: 'Audit Log Dobel-Proyek Manpower',
		parent: 'Project Lapangan',
		href: '/manpower-dobel-override-log',
		permissions: ['view_all_projects', 'view_own_projects', 'view_manpower'],
		keywords: 'manpower dobel proyek override bentrok jadwal absensi ganda dua proyek audit'
	},
	{
		id: 'packing-list',
		title: 'Packing List Proyek',
		parent: 'Project Lapangan',
		href: '/packing-list',
		permissions: ['manage_packing'],
		keywords: 'packing list koli barang box pengiriman material ke site muatan truk ekspedisi'
	},
	{
		id: 'inventory-opname',
		title: 'Opname Inventaris Proyek',
		parent: 'Project Lapangan',
		href: '/inventory-proyek/opname',
		permissions: ['view_all_projects', 'view_own_projects'],
		keywords: 'opname inventaris stok fisik barang proyek hitung sisa cat thinner kuas roller alat'
	},
	{
		id: 'inventory-kritis',
		title: 'Stok Kritis Terpusat',
		parent: 'Project Lapangan',
		href: '/inventory-proyek/kritis-terpusat',
		permissions: ['view_all_projects', 'view_own_projects'],
		keywords: 'stok kritis hampir habis reorder warning emergency stok menipis darurat material'
	},
	{
		id: 'inventory-menganggur',
		title: 'Barang Menganggur Lintas Proyek',
		parent: 'Project Lapangan',
		href: '/inventory-proyek/barang-menganggur',
		permissions: ['view_all_projects', 'view_own_projects'],
		keywords: 'barang menganggur idle stock sisa proyek tak terpakai bisa dimutasi efisiensi'
	},
	{
		id: 'inventory-saldo-semua',
		title: 'Saldo Stok Semua Proyek',
		parent: 'Project Lapangan',
		href: '/inventory-proyek/saldo-semua',
		permissions: ['view_all_projects', 'view_own_projects'],
		keywords: 'saldo stok semua proyek total persediaan barang di seluruh site gudang proyek'
	},
	{
		id: 'kasbon-manpower-terpusat',
		title: 'Kasbon Manpower Terpusat',
		parent: 'Project Lapangan',
		href: '/kasbon-terpusat',
		permissions: ['view_all_projects', 'view_own_projects'],
		keywords: 'kasbon manpower pinjaman uang pekerja tukang mandor kasbon lapangan pencairan'
	},
	{
		id: 'todo-terpusat',
		title: 'To-Do Terpusat Proyek',
		parent: 'Project Lapangan',
		href: '/todo-terpusat',
		permissions: ['view_all_projects', 'view_own_projects'],
		keywords: 'todo to do list tugas pending backlog pekerjaan prioritas task list'
	},
	{
		id: 'closing-evaluasi-terpusat',
		title: 'Closing / Evaluasi Terpusat',
		parent: 'Project Lapangan',
		href: '/closing-evaluasi-terpusat',
		permissions: ['view_all_projects', 'view_own_projects'],
		keywords: 'closing evaluasi serah terima bast bapp proyek selesai penutupan proyek'
	},

	// ── Maintenance & Perawatan Alat (Mekanik Lapangan) ──
	{
		id: 'maint-hub',
		title: 'Hub Perawatan & Bengkel',
		parent: 'Maintenance',
		href: '/perawatan',
		permissions: ['input_maintenance'],
		keywords: 'perawatan maintenance bengkel mekanik servis perbaikan unit alat berat mesin'
	},
	{
		id: 'preventive-maint',
		title: 'Preventive Maintenance & P2H',
		parent: 'Maintenance',
		href: '/preventive',
		permissions: ['input_preventive', 'input_maintenance'],
		keywords: 'preventive maintenance p2h pemeriksaan harian servis berkala ganti oli cek kompresor genset'
	},
	{
		id: 'work-order-saya',
		title: 'Work Order Saya',
		parent: 'Maintenance',
		href: '/maintenance/work-order',
		permissions: ['input_maintenance'],
		keywords: 'work order wo spk perbaikan tugas mekanik perintah servis bengkel status wo'
	},
	{
		id: 'survey-tiket-saya',
		title: 'Survey & Tiket Kerusakan Saya',
		parent: 'Maintenance',
		href: '/maintenance/survey',
		permissions: ['input_maintenance'],
		keywords: 'survey diagnosis tiket keluhan kerusakan analisa mekanik perkiraan sparepart'
	},
	{
		id: 'maint-dashboard',
		title: 'Dashboard Maintenance',
		parent: 'Maintenance',
		href: '/maintenance',
		permissions: ['input_maintenance'],
		keywords: 'dashboard maintenance kpi mtbf mttr downtime unit siap pakai readiness'
	},
	{
		id: 'support-lapangan',
		title: 'Support & Tiket Lapangan',
		parent: 'Maintenance',
		href: '/support',
		permissions: ['input_support', 'access_ess'],
		keywords: 'support tiket bantuan kendala lapangan komplain teknis helpdesk'
	},

	// ── Barang, Gudang & Logistik ──
	{
		id: 'barang-hub',
		title: 'Hub Barang & Logistik',
		parent: 'Barang & Logistik',
		href: '/barang',
		permissions: ['view_stock_lapangan', 'input_stock_lapangan', 'manage_packing'],
		keywords: 'barang hub logistik gudang stok sparepart material penerimaan pengiriman'
	},
	{
		id: 'stock-lapangan',
		title: 'Stok Lapangan & Sparepart',
		parent: 'Barang & Logistik',
		href: '/stock-lapangan',
		permissions: ['view_stock_lapangan', 'input_stock_lapangan'],
		keywords: 'stok lapangan saldo barang sparepart gudang site cat thinner koli box'
	},
	{
		id: 'lapor-komplain-barang',
		title: 'Lapor Komplain Mutu/Barang',
		parent: 'Barang & Logistik',
		href: '/komplain-customer',
		permissions: ['access_ess', 'view_stock_lapangan'],
		keywords: 'komplain barang rusak mutu cacat salah kirim retur barang retur supplier'
	},
	{
		id: 'requisition-proyek',
		title: 'Requisition Barang Proyek',
		parent: 'Barang & Logistik',
		href: '/requisition',
		permissions: ['access_requisition', 'view_all_projects', 'view_own_projects'],
		keywords: 'requisition permintaan material belanja barang pr purchase requisition order barang'
	},
	{
		id: 'field-report-barang',
		title: 'Ringkasan Barang Lapangan',
		parent: 'Barang & Logistik',
		href: '/field-report',
		permissions: ['view_field_report'],
		keywords: 'field report ringkasan barang pemakaian material sisa harian'
	},
	{
		id: 'picking-barcode',
		title: 'Picking Barcode (Packing List)',
		parent: 'Barang & Logistik',
		href: '/packing-list/pick',
		permissions: ['manage_inventory_picking', 'manage_packing'],
		keywords: 'picking barcode scan barang ambil barang sortir kemasan packing list gudang'
	},
	{
		id: 'driver-app',
		title: 'Driver App (Logistik Armada)',
		parent: 'Barang & Logistik',
		href: '/driver',
		permissions: ['access_driver'],
		keywords: 'driver app supir armada pengantaran trip jalan kendaraan surat jalan pod'
	},
	{
		id: 'procurement-pengajuan-beli',
		title: 'Pengajuan Pembelian (Procurement)',
		parent: 'Barang & Logistik',
		href: '/procurement',
		permissions: ['request_budget', 'view_all_projects'],
		keywords: 'procurement pengadaan pembelian barang sparepart po pr belanja'
	},
	{
		id: 'procurement-approval',
		title: 'Approval Pembelian Lapangan',
		parent: 'Barang & Logistik',
		href: '/procurement/approval',
		permissions: ['approve_budget'],
		keywords: 'approval pembelian persetujuan po pr belanja otorisasi dana pengadaan'
	},
	{
		id: 'procurement-terima',
		title: 'Konfirmasi Terima PO / Barang Masuk',
		parent: 'Barang & Logistik',
		href: '/procurement/terima',
		permissions: ['input_stock_lapangan'],
		keywords: 'konfirmasi terima barang masuk receipt penerimaan delivery note surjalanan vendor'
	},
	{
		id: 'procurement-keluar-uang',
		title: 'Keluar Uang (Talangan & Reimburse)',
		parent: 'Barang & Logistik',
		href: '/procurement/keluar-uang',
		permissions: ['view_all_projects', 'view_own_projects'],
		keywords: 'keluar uang talangan advance kasbon reimburse bon nota beli darurat'
	},
	{
		id: 'lacak-sj',
		title: 'Lacak Surat Jalan (Tracking SJ)',
		parent: 'Barang & Logistik',
		href: '/lacak-sj',
		permissions: ['access_ess', 'view_stock_lapangan'],
		keywords: 'lacak sj tracking surat jalan status pengiriman posisi barang ekspedisi'
	},
	{
		id: 'sewa-alat',
		title: 'Sewa Alat Masuk',
		parent: 'Barang & Logistik',
		href: '/sewa-alat',
		permissions: ['view_all_projects', 'view_own_projects'],
		keywords: 'sewa alat masuk rental mesin kompresor scaffolding sewa dari vendor'
	},
	{
		id: 'sewa-keluar',
		title: 'Sewa Alat Keluar',
		parent: 'Barang & Logistik',
		href: '/sewa-keluar',
		permissions: ['view_all_projects', 'view_own_projects'],
		keywords: 'sewa alat keluar pinjamkan alat ke client tarif sewa perjanjian rental'
	},

	// ── HRD, GA & Keamanan Lapangan ──
	{
		id: 'hrga-hub',
		title: 'Hub HRD & GA Lapangan',
		parent: 'HRD & GA',
		href: '/hrga/hub',
		permissions: ['access_ga_checklist', 'access_security', 'view_manpower'],
		keywords: 'hrga hub hrd ga general affairs fasilitas satpam mess kantor'
	},
	{
		id: 'ga-checklist',
		title: 'GA Checklist Fasilitas & Mess',
		parent: 'HRD & GA',
		href: '/ga-checklist',
		permissions: ['access_ga_checklist'],
		keywords: 'ga checklist kebersihan mess ac kamar mandi fasilitas kantor inspeksi gedung'
	},
	{
		id: 'ga-request',
		title: 'Permintaan Layanan GA',
		parent: 'HRD & GA',
		href: '/ga-request',
		permissions: ['access_ess'],
		keywords: 'ga request permintaan atk galon air lampu perbaikan fasilitas umum'
	},
	{
		id: 'fleet-booking',
		title: 'Peminjaman Kendaraan (Fleet Booking)',
		parent: 'HRD & GA',
		href: '/fleet-booking',
		permissions: ['access_fleet_booking'],
		keywords: 'fleet booking pinjam mobil dinas kendaraan operasional bensin supir armada'
	},
	{
		id: 'satpam',
		title: 'Keamanan & Satpam (Pos Jaga)',
		parent: 'HRD & GA',
		href: '/satpam',
		permissions: ['access_security'],
		keywords: 'satpam security pos jaga pos satpam buku tamu visitor gate keluar masuk'
	},
	{
		id: 'satpam-ronda',
		title: 'Ronda & Checkpoint Satpam',
		parent: 'HRD & GA',
		href: '/satpam/ronda',
		permissions: ['access_security', 'patrol_scan'],
		keywords: 'ronda satpam checkpoint patroli barcode pos keliling malam keamanan site'
	},
	{
		id: 'manpower-list',
		title: 'Manpower & Tim Regu',
		parent: 'HRD & GA',
		href: '/manpower',
		permissions: ['view_manpower'],
		keywords: 'manpower pekerja tukang mandor data karyawan lapangan kontak no hp keahlian'
	},
	{
		id: 'legal-hak-cipta',
		title: 'Legal & Hak Cipta',
		parent: 'HRD & GA',
		href: '/legal/hak-cipta',
		keywords: 'legal hak cipta aturan perlindungan data si-tama'
	},

	// ── HSE & K3 Lapangan ──
	{
		id: 'hse-hub',
		title: 'Hub HSE & Mutu',
		parent: 'HSE (K3 & Mutu)',
		href: '/hse/hub',
		permissions: ['access_hse'],
		keywords: 'hse k3 keselamatan kerja mutu kesehatan lingkungan apd safety'
	},
	{
		id: 'hse-dashboard',
		title: 'Dashboard HSE & Insiden',
		parent: 'HSE (K3 & Mutu)',
		href: '/hse',
		permissions: ['access_hse'],
		keywords: 'dashboard hse insiden kecelakaan kerja near miss investigasi capa capa tracker'
	},
	{
		id: 'jsa',
		title: 'Job Safety Analysis (JSA)',
		parent: 'HSE (K3 & Mutu)',
		href: '/jsa',
		permissions: ['access_hse', 'hse_jsa_create'],
		keywords: 'jsa job safety analysis analisis potensi bahaya izin kerja permit to work k3'
	},
	{
		id: 'toolbox-meeting',
		title: 'Toolbox Meeting (TBM)',
		parent: 'HSE (K3 & Mutu)',
		href: '/toolbox',
		permissions: ['access_hse', 'hse_toolbox_lead'],
		keywords: 'toolbox meeting tbm safety talk briefing pagi pengarahan k3 absensi briefing'
	},
	{
		id: 'inspection-bpir',
		title: 'Inspection Report (BPIR / QC)',
		parent: 'HSE (K3 & Mutu)',
		href: '/inspection',
		permissions: ['input_inspection'],
		keywords: 'inspection bpir quality control qc inspeksi ketebalan dft cat adhesi serah terima'
	},

	// ── Sales & Pemasaran Lapangan ──
	{
		id: 'sales-hub',
		title: 'Hub Sales & Marketing',
		parent: 'Sales Lapangan',
		href: '/sales/hub',
		permissions: ['input_sales'],
		keywords: 'sales marketing penjualan prospek tender customer kunjungan'
	},
	{
		id: 'sales-log',
		title: 'Log Kunjungan Sales',
		parent: 'Sales Lapangan',
		href: '/sales',
		permissions: ['input_sales'],
		keywords: 'sales visit kunjungan customer riwayat meeting penawaran harga'
	},
	{
		id: 'sales-po',
		title: 'PO Customer Lapangan',
		parent: 'Sales Lapangan',
		href: '/sales/po',
		permissions: ['input_sales'],
		keywords: 'po customer purchase order klien order penjualan sales order so'
	},
	{
		id: 'sales-prospek',
		title: 'Prospek Sales (Pipeline)',
		parent: 'Sales Lapangan',
		href: '/sales/prospek',
		permissions: ['input_sales'],
		keywords: 'prospek sales pipeline peluang proyek calon pelanggan lead'
	},
	{
		id: 'sales-baru',
		title: 'Input Kunjungan Sales Baru',
		parent: 'Sales Lapangan',
		href: '/sales/baru',
		permissions: ['input_sales'],
		keywords: 'input kunjungan sales baru check in sales form kunjungan meeting baru'
	},
	{
		id: 'sales-kemitraan',
		title: 'Kemitraan & Atribusi Sales',
		parent: 'Sales Lapangan',
		href: '/kemitraan',
		permissions: ['input_sales'],
		keywords: 'kemitraan atribusi rekanan fee komisi referral partner agen'
	},
	{
		id: 'csr-program',
		title: 'CSR & Program TJSL',
		parent: 'Sales Lapangan',
		href: '/csr',
		keywords: 'csr tjsl tanggung jawab sosial bantuan masyarakat santunan beasiswa'
	},

	// ── Produksi & Kiosk ──
	{
		id: 'produksi-hub',
		title: 'Hub Produksi & R&D',
		parent: 'Produksi & R&D',
		href: '/produksi/hub',
		permissions: ['input_produksi_harian', 'access_rnd'],
		keywords: 'produksi rnd pabrik cat mixing adonan output harian tonase batch'
	},
	{
		id: 'produksi-input',
		title: 'Input Produksi Harian',
		parent: 'Produksi & R&D',
		href: '/produksi/input-harian',
		permissions: ['input_produksi_harian'],
		keywords: 'input produksi harian spk hasil olahan cat pasta formula liter kg batch'
	},
	{
		id: 'produksi-monitoring',
		title: 'Monitoring Produksi',
		parent: 'Produksi & R&D',
		href: '/produksi',
		permissions: ['input_produksi_harian'],
		keywords: 'monitoring produksi dashboard output oee target realisasi pabrik'
	},
	{
		id: 'rnd-doc',
		title: 'R&D — Dokumen TDS/MSDS',
		parent: 'Produksi & R&D',
		href: '/rnd',
		permissions: ['access_rnd'],
		keywords: 'rnd tds msds spesifikasi produk lembar teknis keselamatan cat formula'
	},
	{
		id: 'produk-katalog',
		title: 'Katalog Produk Lapangan',
		parent: 'Produksi & R&D',
		href: '/produk',
		permissions: ['access_rnd'],
		keywords: 'katalog produk brosur daftar cat primer topcoat epoxy polyurethane'
	},
	{
		id: 'kiosk-home',
		title: 'Kiosk Terminal Gudang / Produksi',
		parent: 'Produksi & R&D',
		href: '/kiosk/home',
		keywords: 'kiosk terminal touch station barcode scan input cepat absen istirahat roll call'
	},

	// ── Bantuan & Panduan ──
	{
		id: 'panduan-lengkap',
		title: 'Panduan Lengkap Lapangan',
		parent: 'Bantuan & Panduan',
		href: '/panduan',
		keywords: 'panduan lengkap cara penggunaan manual faq tutorial sop petunjuk'
	},
	{
		id: 'bantuan-anda',
		title: 'Bantuan Untuk Anda',
		parent: 'Bantuan & Panduan',
		href: '/bantuan',
		keywords: 'bantuan kontak helpdesk cara pakai masalah login kendala aplikasi'
	}
];
