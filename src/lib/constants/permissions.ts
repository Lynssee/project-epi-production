import { get } from 'svelte/store';
import { getRoleById, mandatoryFeaturesStore } from '$lib/stores/roles';
import { authStore } from '$lib/stores/auth';
import type { AppRole } from '$lib/services/roles';

export type FeatureKey =
	| 'view_all_projects'
	| 'view_own_projects'
	| 'input_laporan'
	| 'approve_laporan'
	| 'request_budget'
	| 'approve_budget'
	| 'manage_packing'
	| 'manage_inventory_picking'
	| 'view_manpower'
	| 'manage_users'
	| 'admin_panel'
	| 'input_preventive'
	| 'view_field_report'
	| 'input_stock_lapangan'
	| 'view_stock_lapangan'
	| 'input_maintenance'
	| 'input_sales'
	| 'verify_sales'
	| 'input_support'
	| 'access_ess'
	| 'access_site_checkin'
	| 'approve_cuti_ess'
	| 'access_driver'
	| 'execute_trip'
	| 'submit_pod'
	| 'submit_vehicle_check'
	| 'access_ga_checklist'
	| 'access_security'
	| 'patrol_scan'
	| 'gate_log'
	| 'visitor_log'
	| 'report_incident'
	| 'access_hse'
	| 'hse_jsa_create'
	| 'hse_toolbox_lead'
	| 'hse_soc_create'
	| 'submit_pengajuan_pembelian'
	| 'approve_pengajuan_pembelian'
	| 'terima_barang_po'
	| 'access_csr'
	| 'input_inspection'
	| 'view_sji'
	| 'input_sji'
	| 'access_fleet_booking'
	| 'access_rnd'
	| 'view_rap'
	| 'access_requisition'
	| 'access_ess_admin'
	| 'override_project_data_gate'
	| 'input_produksi_harian'
	| 'input_komplain_customer'
	| 'manage_komplain_8d'
	| 'approve_sample_request'
	| 'absensi_tim_lapangan'
	| 'verifikasi_absensi_tim'
	| 'access_pl_dashboard'
	| 'verify_area_inventory'
	| 'kelola_aset_ruangan'
	| 'kickoff_lengkapi'
	| 'ajukan_atas_nama';

export const FEATURE_LABELS: Record<FeatureKey, string> = {
	view_all_projects: 'Lihat Semua Proyek',
	view_own_projects: 'Lihat Proyek Sendiri',
	input_laporan:     'Input Laporan Harian',
	approve_laporan:   'Verifikasi Laporan',
	request_budget:    'Ajukan Anggaran',
	approve_budget:    'Approve Anggaran',
	manage_packing:    'Kelola Packing List',
	manage_inventory_picking: 'Kelola Picking Barcode (Ambil Barang Sesuai Permintaan)',
	view_manpower:     'Data Manpower',
	manage_users:      'Kelola Pengguna',
	admin_panel:       'Akses Admin Panel',
	input_preventive:  'Input Ceklist Preventive',
	view_field_report: 'Lihat Field Reporting Dashboard',
	input_stock_lapangan: 'Input Stock Lapangan',
	view_stock_lapangan:  'Lihat Dashboard Stock Lapangan',
	input_maintenance:    'Input Laporan Maintenance (Work Order)',
	input_sales:          'Input Kunjungan Sales (Visit)',
	verify_sales:         'Verifikasi Kunjungan Sales',
	input_support:        'Input Tiket Support (Lapangan)',
	access_ess:           'Akses Absensi Mandiri (ESS)',
	access_site_checkin:  'Akses Check-in Lapangan Berbasis Proyek (Site Check-in)',
	approve_cuti_ess:     'Approval Cuti dari HP (Atasan)',
	access_driver:        'Akses Driver App',
	execute_trip:         'Mulai/Selesai Trip Driver',
	submit_pod:           'Input Bukti Pengiriman (POD)',
	submit_vehicle_check: 'Input Cek Kendaraan (P2H) & BBM',
	access_ga_checklist: 'Akses GA Checklist (Kebersihan/Keamanan/K3/Fasilitas)',
	access_security:     'Akses Modul Keamanan (Satpam)',
	patrol_scan:         'Scan Ronda / Patroli QR',
	gate_log:            'Input Gate Log (Orang & Barang)',
	visitor_log:         'Input Buku Tamu & Kendaraan',
	report_incident:     'Lapor Insiden & Tombol Panic',
	access_hse:          'Akses HSE (Lapor Near-Miss/Insiden K3, MSDS, APD, Izin Kerja)',
	hse_jsa_create:      'Buat & Kelola JSA Proyek (HIRADC)',
	hse_toolbox_lead:    'Pimpin & Catat Toolbox Meeting Proyek',
	hse_soc_create:      'Isi Kartu Observasi Keselamatan (SOC)',
	submit_pengajuan_pembelian:  'Ajukan Pembelian (Procurement Lapangan)',
	approve_pengajuan_pembelian: 'Approval Pembelian dari HP',
	terima_barang_po:            'Konfirmasi Terima Barang PO (Lapangan)',
	access_csr:                  'Akses CSR / TJSL (Intake Penerima Manfaat, Foto+GPS Kegiatan, Serah Terima)',
	input_inspection:            'Input Blasting & Painting Inspection Report (BPIR)',
	view_sji:                    'Lihat Surat Jalan Internal',
	input_sji:                   'Ajukan Surat Jalan Internal (Ambil/Pinjam Barang)',
	access_fleet_booking:        'Ajukan Peminjaman Kendaraan (Fleet Self-Service)',
	access_rnd:                  'Akses R&D Lapangan (Cari TDS/MSDS, Panduan Aplikasi, Lapor Masalah Produk)',
	view_rap:                    'Lihat & Kelola RAP vs Realisasi Proyek',
	access_requisition:          'Requisition / Permintaan Barang Proyek',
	access_ess_admin:            'Panel Admin HRD / ESS',
	override_project_data_gate: 'Override Gerbang Kelengkapan Data Proyek (khusus General Manager)',
	input_produksi_harian:      'Input Produksi Harian (Output/Reject/Waste per SPK)',
	input_komplain_customer:    'Lapor Komplain Customer (Lapangan)',
	manage_komplain_8d:         'Kelola & Ubah Fase Penanganan Komplain 8D (SPV/Manager)',
	approve_sample_request:     'Setujui / Tolak Request Sample Cat (SPV Sales)',
	absensi_tim_lapangan:       'Absenkan Anggota Regu (Manpower Leader)',
	verifikasi_absensi_tim:     'Verifikasi Absensi Regu — Lapis 1 (Manpower Leader)',
	access_pl_dashboard:        'Akses Dashboard Project Leader (KPI, Review Laporan, Workload, PM)',
	// Fase 3 (Rencana Sistem Penempatan Area Inventory & Verifikasi Barcode v2, 20 Agu 2026, Q2):
	// jalur SPV-ke-atas untuk submit verifikasi/cek-area. PIC per-rak (gudang.pic_karyawan_ids)
	// bisa submit untuk raknya sendiri TANPA permission ini -- lihat resolvePicOrSpv() di cekAreaApi.ts.
	verify_area_inventory:      'Submit Verifikasi/Cek-Area Inventory (SPV ke atas)',
	// Fase 4 (Penajaman Modul Produksi v2, 26 Agu 2026): cetak label produk
	// self-service dari lapangan, lewat endpoint yang sama dengan admin
	// (erp-epi-1 /api/print/product-label) -- lihat produksi/cetak-label.
	production_label_print:    'Cetak Label Produk (Self-Service Lapangan)',
	// "Barang per Ruangan via QR Patroli" (Fase 3, 10 Sep 2026): tambah/ubah barang
	// sebuah ruangan dari HP (sensus & koreksi qty/kondisi). Keputusan Lead: Admin GA
	// + OB/Cleaning leader + Kepala Divisi pemilik ruangan. Binding role final diatur
	// admin di UI Peran; default seed di bawah hanya hrd + manager (super_admin auto).
	kelola_aset_ruangan:       'Kelola Barang per Ruangan (Sensus & Koreksi dari HP)',
	// Kickoff Wizard v2 (8 Sep 2026): PL/koordinator lapangan mencentang & mengunggah
	// bukti untuk item persiapan yang jadi porsinya (owner 'leader'/'both').
	kickoff_lengkapi:          'Lengkapi Persiapan Proyek (Checklist & Foto Porsi Lapangan)',
	ajukan_atas_nama:          'Ajukan Anggaran/Pembelian ATAS NAMA Anggota Proyek (Supervisor; Leader/Wakil Proyek otomatis untuk proyeknya sendiri)',
};

// Kept for initial migration if the database is empty
export const DEFAULT_ROLE_PERMISSIONS: Record<string, FeatureKey[]> = {
	super_admin:   ['view_all_projects', 'input_laporan', 'approve_laporan', 'request_budget', 'approve_budget', 'manage_packing', 'manage_inventory_picking', 'view_manpower', 'manage_users', 'admin_panel', 'input_preventive', 'view_field_report', 'input_stock_lapangan', 'view_stock_lapangan', 'input_sales', 'verify_sales', 'input_komplain_customer', 'manage_komplain_8d', 'approve_sample_request', 'submit_pengajuan_pembelian', 'approve_pengajuan_pembelian', 'terima_barang_po', 'access_hse', 'hse_jsa_create', 'hse_toolbox_lead', 'hse_soc_create', 'access_csr', 'access_rnd', 'view_rap', 'access_requisition', 'access_ess_admin'],
	admin_project: ['view_all_projects', 'approve_laporan', 'request_budget', 'manage_packing', 'view_manpower', 'view_field_report', 'view_stock_lapangan', 'submit_pengajuan_pembelian', 'approve_pengajuan_pembelian', 'terima_barang_po', 'access_hse', 'hse_jsa_create', 'hse_toolbox_lead', 'hse_soc_create', 'access_csr', 'access_fleet_booking', 'access_rnd', 'view_rap', 'access_requisition', 'verify_area_inventory', 'manage_komplain_8d', 'kickoff_lengkapi', 'access_ess'],
	leader:        ['view_own_projects', 'input_laporan', 'request_budget', 'manage_packing', 'view_manpower', 'input_preventive', 'view_field_report', 'input_stock_lapangan', 'input_support', 'access_ess', 'access_site_checkin', 'approve_cuti_ess', 'submit_pengajuan_pembelian', 'terima_barang_po', 'access_hse', 'hse_jsa_create', 'hse_toolbox_lead', 'hse_soc_create', 'access_csr', 'input_inspection', 'view_sji', 'access_fleet_booking', 'access_rnd', 'access_requisition', 'view_rap', 'access_pl_dashboard', 'verify_area_inventory', 'kickoff_lengkapi'],
	// Manpower Leader — posisi tertinggi DI LAPANGAN, pegangan koordinasi saat Project
	// Leader tidak di lokasi. Sengaja lebih sempit dari role `leader`: TIDAK diberi
	// request_budget, manage_packing, input_stock_lapangan, submit_pengajuan_pembelian,
	// maupun view_rap — itu wewenang Project Leader, bukan koordinator lapangan.
	manpower_leader: ['view_own_projects', 'input_laporan', 'absensi_tim_lapangan', 'verifikasi_absensi_tim', 'view_manpower', 'access_ess', 'access_site_checkin', 'input_support', 'access_hse', 'hse_soc_create', 'kickoff_lengkapi'],
	admin_inventory: ['view_all_projects', 'manage_packing', 'manage_inventory_picking', 'view_stock_lapangan', 'input_stock_lapangan', 'view_sji', 'input_sji', 'terima_barang_po', 'view_field_report', 'access_requisition', 'verify_area_inventory', 'production_label_print', 'access_ess'],
	finance:       ['view_all_projects', 'approve_budget', 'access_hse', 'view_rap', 'access_ess'],
	hrd:           ['view_all_projects', 'view_manpower', 'access_hse', 'hse_soc_create', 'access_csr', 'access_ess_admin', 'kelola_aset_ruangan', 'access_ess'],
	director:      ['view_all_projects', 'approve_budget', 'view_field_report', 'view_stock_lapangan', 'approve_pengajuan_pembelian', 'access_hse', 'verify_area_inventory', 'access_ess'],
	manager:       ['view_all_projects', 'view_manpower', 'view_field_report', 'view_stock_lapangan', 'approve_pengajuan_pembelian', 'access_hse', 'access_fleet_booking', 'override_project_data_gate', 'verify_area_inventory', 'manage_komplain_8d', 'approve_sample_request', 'kelola_aset_ruangan', 'access_ess'],
	staff:         ['view_own_projects', 'input_laporan', 'input_preventive', 'input_support', 'access_ess', 'access_site_checkin', 'access_ga_checklist', 'submit_pengajuan_pembelian', 'access_hse', 'hse_soc_create', 'access_csr', 'input_inspection', 'access_fleet_booking', 'access_rnd', 'input_produksi_harian', 'input_komplain_customer', 'production_label_print'],
	operator:      ['view_own_projects', 'input_preventive', 'input_support', 'access_ga_checklist', 'access_hse', 'hse_soc_create', 'view_sji', 'input_sji', 'access_rnd', 'input_produksi_harian', 'production_label_print', 'access_ess'],
	sales:         ['input_sales', 'access_hse', 'access_fleet_booking', 'access_rnd', 'input_komplain_customer', 'access_ess'],
	driver:        ['access_driver', 'execute_trip', 'submit_pod', 'submit_vehicle_check', 'access_hse', 'access_ess'],
	satpam:        ['access_security', 'patrol_scan', 'gate_log', 'visitor_log', 'report_incident', 'access_hse', 'hse_soc_create', 'access_ess'],
};

export const DEFAULT_ROLE_OPTIONS = [
	{ id: 'super_admin', label: 'Super Admin', desc: 'Akses penuh ke semua fitur' },
	{ id: 'admin_project', label: 'Admin Proyek', desc: 'Kelola proyek dan verifikasi laporan' },
	{ id: 'leader', label: 'Leader Proyek', desc: 'Input laporan harian dan ajukan anggaran' },
	{ id: 'manpower_leader', label: 'Manpower Leader (Lapangan)', desc: 'Koordinator tertinggi di lapangan: absenkan & verifikasi regu, input laporan harian' },
	{ id: 'admin_inventory', label: 'Admin Inventory', desc: 'Kelola stok gudang & picking barang sesuai permintaan proyek' },
	{ id: 'finance', label: 'Finance', desc: 'Kelola pencairan anggaran' },
	{ id: 'hrd', label: 'HRD', desc: 'Human resource management' },
	{ id: 'director', label: 'Direktur', desc: 'Approval dan oversight' },
	{ id: 'manager', label: 'Manager', desc: 'Manajemen tim dan proyek' },
	{ id: 'staff', label: 'Staff', desc: 'Akses dasar' },
	{ id: 'sales', label: 'Sales Representative', desc: 'Input kunjungan (visit) & laporan lapangan Sales' },
	{ id: 'driver', label: 'Driver', desc: 'Eksekusi trip, POD, cek kendaraan & BBM dari HP' },
	{ id: 'satpam', label: 'Satpam', desc: 'Patroli QR, gate log, buku tamu, kendaraan & insiden dari HP' }
];

export function hasPermission(
	roleId: string | null,
	feature: FeatureKey,
	roles?: AppRole[],
	roleIds?: string[]
): boolean {
	const currentRoleIds = roleIds || get(authStore).roleIds || [];

	if (!roleId && (!currentRoleIds || currentRoleIds.length === 0)) return false;

	// Super admin ALWAYS has access to everything — cek baik roleId maupun roleIds
	if (roleId === 'super_admin') return true;
	if (currentRoleIds.includes('super_admin')) return true;

	// Rencana RBAC v2, Bagian 6/8.2: fitur wajib berlaku untuk semua pengguna
	// aktif terlepas dari role — daftar dari rbac_config (bukan hardcode),
	// lihat mandatoryFeaturesStore di $lib/stores/roles.ts.
	if (get(mandatoryFeaturesStore).includes(feature)) return true;

	// access_ess diperluas ke SEMUA role (14 Sep 2026, permintaan user) — sebelumnya
	// hanya leader/manpower_leader/staff per DEFAULT_ROLE_PERMISSIONS, jadi sales/driver/
	// satpam/finance/hrd/direktur/manager/admin sama sekali tidak bisa membuka Portal
	// Karyawan (termasuk Pengajuan Kas Kecil). Hardcode di sini (bukan cuma rbac_config
	// Firestore) supaya berlaku langsung tanpa perlu tulis data live yang tidak bisa
	// dilakukan dari sesi ini. Kalau nanti mandatoryFeatures di rbac_config sudah memuat
	// access_ess juga, baris ini jadi redundan tapi tidak berbahaya (idempoten).
	if (feature === 'access_ess') return true;

	// Kumpulkan semua roleId yang perlu diperiksa. Gabungkan roleId utama
	// dengan roleIds[] (kalau ada) lalu deduplikasi.
	const idsToCheck = new Set<string>();
	if (roleId) idsToCheck.add(roleId);
	currentRoleIds.forEach(id => idsToCheck.add(id));

	// Cek apakah salah satu role memiliki permission yang diminta
	for (const id of idsToCheck) {
		const role = roles && roles.length > 0 ? roles.find(r => r.id === id) : getRoleById(id);
		if (role) {
			if (role.permissions?.includes(feature)) return true;
		} else {
			// Fallback ke default role permissions (untuk role lama sebelum migrasi Directus)
			if (DEFAULT_ROLE_PERMISSIONS[id]?.includes(feature)) return true;

			// Debug: bantu diagnose mismatch antara roleId Firestore dan posisi Directus
			// (hanya di development, tidak di production)
			if (typeof window !== 'undefined' && (import.meta as any)?.env?.DEV) {
				const allRoles = roles || [];
				if (allRoles.length > 0) {
					console.warn(
						`[hasPermission] roleId "${id}" tidak ditemukan di rolesStore (${allRoles.length} roles loaded).`,
						`Tersedia: [${allRoles.map(r => r.id + ':' + r.label).join(', ')}]`,
						`Feature yang dicek: ${feature}`
					);
				}
			}
		}
	}

	return false;
}
