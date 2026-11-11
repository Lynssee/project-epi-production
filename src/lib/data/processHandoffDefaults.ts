// src/lib/data/processHandoffDefaults.ts
// Cermin `DEFAULT_HANDOFFS` erp-epi (src/lib/utils/processGrandMap.js): 28 titik serah-terima lintas modul awal Peta Alur Bisnis Grand.
// Dipakai HANYA bila Super Admin belum menyimpan konfigurasi Peta Grand (app_settings). Setelah disimpan di erp-epi, daftar tersimpan yang berlaku.
import type { ConfigHandoff, HandoffType } from '$lib/utils/processHandoffChain';

const H = (code: string, from_flow: string, from_node: string, to_flow: string, to_node: string, handoff_type: HandoffType, doc_label: string): ConfigHandoff => ({
	code, from_flow, from_node, to_flow, to_node, handoff_type, doc_label
});

export const DEFAULT_HANDOFFS: ConfigHandoff[] = [
	H('H01', 'sales_to_inventory', 'minta_produk', 'sales_to_inventory', 'cek_produk', 'dokumen', 'Permintaan Produk SO Cat'),
	H('H02', 'sales_to_inventory', 'spk_proyek', 'project_field_execution', 'prj_kickoff', 'dokumen', 'Form SPK Proyek & Kontrak'),
	H('H03', 'sales_to_inventory', 'kontrak_sewa', 'budget_and_finance_approval', 'fin_cair', 'dana', 'Kontrak Rental & Uang Jaminan'),
	H('H04', 'sales_to_inventory', 'cek_produk', 'procurement_to_pay', 'p2p_pr', 'dokumen', 'Purchase Request (PR) Barang — stok kosong'),
	H('H05', 'sales_to_inventory', 'cek_produk', 'production_to_warehouse', 'prod_spk', 'dokumen', 'Permintaan SPK Produksi Cat'),
	H('H06', 'qc_paint_laboratory_and_rnd_trial', 'lab_terbit_coa', 'production_to_warehouse', 'prod_formula', 'otorisasi', 'Master Formula Aktif & Standar Delta-E'),
	H('H07', 'production_to_warehouse', 'prod_in_wh', 'sales_to_inventory', 'alokasi', 'barang', 'Batch Barang Jadi (FG) + Sertifikat CoA'),
	H('H08', 'procurement_to_pay', 'p2p_po', 'procurement_to_pay', 'p2p_terima', 'dokumen', 'Purchase Order Supplier + Target ETA'),
	H('H09', 'procurement_to_pay', 'p2p_grn', 'accounts_payable_and_supplier_settlement', 'ap_3way_matching', 'dokumen', 'GRN Gudang + Foto Bukti Terima'),
	H('H10', 'dispatch_and_shipping', 'sj_cetak', 'fleet_and_vehicle_management', 'flt_booking_pengajuan', 'dokumen', 'Surat Jalan Rangkap & Booking Armada'),
	H('H11', 'dispatch_and_shipping', 'sj_outbound', 'project_field_execution', 'prj_terima_mat', 'barang', 'Pengiriman Cat, Thinner & Abrasive ke Site'),
	H('H12', 'dispatch_and_shipping', 'sj_selesai_arsip', 'invoicing_and_ar_collection', 'ar_draft_invoice', 'dokumen', 'Lembar Asli SJ Bertanda Tangan Customer'),
	H('H13', 'project_mobilization_readiness', 'readiness_pa_pr', 'fleet_and_vehicle_management', 'flt_booking_pengajuan', 'dokumen', 'Permintaan Alokasi Armada & Alat Mobilisasi'),
	H('H14', 'project_field_execution', 'prj_mobilisasi', 'project_jsa_and_field_safety_compliance', 'jsa_toolbox_briefing', 'dokumen', 'Daftar Personel Site Check-in & Area Kerja'),
	H('H15', 'project_jsa_and_field_safety_compliance', 'jsa_otorisasi_kerja', 'project_field_execution', 'prj_blasting_paint', 'otorisasi', 'Izin Kerja Aman (PTW), JSA & Absensi Toolbox'),
	H('H16', 'project_field_execution', 'prj_blasting_paint', 'maintenance_repair_lifecycle', 'maint_start', 'dokumen', 'Tiket Laporan Kerusakan Alat + Foto'),
	H('H17', 'maintenance_repair_lifecycle', 'maint_pr_part', 'procurement_to_pay', 'p2p_pr', 'dokumen', 'PR Sparepart Tertaut Nomor WO'),
	H('H18', 'maintenance_repair_lifecycle', 'maint_close', 'project_field_execution', 'prj_blasting_paint', 'otorisasi', 'Rilis Surat Sakit & BA Uji QC — alat kembali ke site'),
	H('H19', 'project_field_execution', 'prj_bast', 'invoicing_and_ar_collection', 'ar_draft_invoice', 'dokumen', 'BAST Disetujui Klien + Foto'),
	H('H20', 'project_handover_and_closing', 'close_demobilisasi_retur', 'inter_project_material_transfer', 'mut_retur_gudang', 'barang', 'Sisa Material Cat Layak Pakai & Alat Proyek'),
	H('H21', 'hrd_recruitment_and_pkwt_onboarding', 'rec_ttd_kontrak_pkwt', 'hse_safety_incident_lifecycle', 'hse_jsa_ptw', 'otorisasi', 'Personel Baru Terkontrak PKWT — wajib induksi K3'),
	H('H22', 'hrd_recruitment_and_pkwt_onboarding', 'rec_onboarding_selesai', 'project_field_execution', 'prj_mobilisasi', 'otorisasi', 'Teknisi Ber-ID Card, Lulus Induksi & APD Lengkap'),
	H('H23', 'employee_self_service_ess', 'ess_verifikasi_hrd', 'hrd_payroll_lifecycle', 'pay_hitung_komponen', 'dokumen', 'Kuota Cuti, Jam SPKL Lembur & Potongan Kasbon'),
	H('H24', 'manpower_borongan_termin', 'borong_pengajuan_pa', 'budget_and_finance_approval', 'fin_approval', 'dana', 'SPK Borongan & BAP Progres Fisik (Termin)'),
	H('H25', 'hrd_payroll_lifecycle', 'pay_verif_manajer', 'budget_and_finance_approval', 'fin_cair', 'dana', 'Rekap Payroll Disetujui + CSV Transfer Bank'),
	H('H26', 'petty_cash_and_lpj_settlement', 'pc_verifikasi_lpj', 'budget_and_finance_approval', 'fin_jurnal_rekon', 'dokumen', 'LPJ + Nota Asli'),
	H('H27', 'accounts_payable_and_supplier_settlement', 'ap_eksekusi_dan_lunas', 'procurement_to_pay', 'p2p_pay', 'dana', 'Bukti Transfer Pelunasan Supplier & Jurnal AP'),
	H('H28', 'invoicing_and_ar_collection', 'ar_penerimaan_lunas', 'sales_to_inventory', 'so', 'otorisasi', 'Jurnal Pelunasan Piutang & Pembukaan Credit Hold'),
	H('H29', 'fleet_and_vehicle_management', 'flt_verifikasi_kelaikan', 'ga_key_custody_and_shift_reconciliation', 'kunci_pinjam_di_pos_jaga', 'barang', 'Kunci Kendaraan — slot tertera di tiket booking (ambil di pos jaga)')
];
