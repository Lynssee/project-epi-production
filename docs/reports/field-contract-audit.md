# Field Contract Audit

Dibuat: 2026-10-06T02:21:42.812Z
File dipindai: 1378

## Kolom Diminta Tapi Tidak Ada di Skema (63)

| File | Baris | Koleksi Query | Field Path | Kolom Hilang | Hilang di Koleksi |
|---|---:|---|---|---|---|
| src\lib\server\ess\karyawan.ts | 52 | karyawan | `foto` | `foto` | karyawan |
| src\lib\server\fleetApprovalProgress.ts | 50 | approval_workflow_steps | `module_key` | `module_key` | approval_workflow_steps |
| src\lib\server\grandPoLapangan.ts | 99 | grand_po_members | `nama` | `nama` | grand_po_members |
| src\lib\server\grandPoLapangan.ts | 99 | grand_po_members | `nomor_gpo` | `nomor_gpo` | grand_po_members |
| src\lib\server\kioskGudang.ts | 320 | identitas_barang | `parent_category$` | `parent_category$` | identitas_barang |
| src\lib\server\laporanWriteGate.ts | 57 | gate_enforcement | `default_mode` | `default_mode` | gate_enforcement |
| src\lib\server\projectNotify.ts | 159 | karyawan | `no_telpon` | `no_telpon` | karyawan |
| src\lib\server\searchService.ts | 43 | work_order | `status` | `status` | work_order |
| src\lib\server\siteCheckin.ts | 189 | master_customer | `customer_name` | `customer_name` | master_customer |
| src\lib\server\sjTracking.ts | 89 | scan_log | `track_stage` | `track_stage` | scan_log |
| src\lib\services\kalkulatorPenawaran.ts | 69 | kalkulator_config | `type` | `type` | kalkulator_config |
| src\lib\services\kalkulatorPenawaran.ts | 69 | kalkulator_config | `unit` | `unit` | kalkulator_config |
| src\lib\services\kalkulatorPenawaran.ts | 69 | kalkulator_config | `default_productivity` | `default_productivity` | kalkulator_config |
| src\lib\services\kalkulatorPenawaran.ts | 69 | kalkulator_config | `name` | `name` | kalkulator_config |
| src\lib\services\kalkulatorPenawaran.ts | 69 | kalkulator_config | `rate` | `rate` | kalkulator_config |
| src\lib\services\kalkulatorPenawaran.ts | 99 | kalkulator_config | `nomor_penawaran` | `nomor_penawaran` | kalkulator_config |
| src\lib\services\kemitraan.ts | 89 | master_supplier | `telepon` | `telepon` | master_supplier |
| src\lib\services\kemitraan.ts | 89 | master_supplier | `kontak_person` | `kontak_person` | master_supplier |
| src\lib\services\kemitraan.ts | 89 | master_supplier | `kategori_bidang` | `kategori_bidang` | master_supplier |
| src\lib\services\manpowerAbsensi.ts | 218 | manpower_absensi | `manpower_id.rate_upah_harian` | `rate_upah_harian` | manpower |
| src\lib\services\manpowerAbsensi.ts | 218 | manpower_absensi | `manpower_id.rate_lembur` | `rate_lembur` | manpower |
| src\lib\services\manpowerAbsensi.ts | 218 | manpower_absensi | `manpower_id.rate_standby` | `rate_standby` | manpower |
| src\lib\services\preventive.ts | 164 | p2h_log | `{ p2h_template_id: ['item_name` | `{ p2h_template_id: ['item_name` | p2h_log |
| src\lib\services\projectDocumentsApi.ts | 114 | document_checklist_template | `items.is_required` | `is_required` | items |
| src\lib\services\projectDocumentsApi.ts | 114 | document_checklist_template | `items.urutan` | `urutan` | items |
| src\lib\services\projectDocumentsApi.ts | 114 | document_checklist_template | `items.document_type_id` | `document_type_id` | items |
| src\lib\services\projectStockBalanceApi.ts | 47 | items | `nama_barang_lengkap` | `nama_barang_lengkap` | items |
| src\lib\services\projectStockBalanceApi.ts | 47 | items | `satuan` | `satuan` | items |
| src\lib\services\sewaAlatLapanganApi.ts | 63 | contact | `nama` | `nama` | contact |
| src\lib\services\spkDailyLogApi.ts | 68 | identitas_barang | `kode_barang` | `kode_barang` | identitas_barang |
| src\lib\services\spkDailyLogApi.ts | 382 | spk | `output_kg` | `output_kg` | spk |
| src\lib\services\spkDailyLogApi.ts | 382 | spk | `reject_kg` | `reject_kg` | spk |
| src\lib\services\spkDailyLogApi.ts | 382 | spk | `waste_kg` | `waste_kg` | spk |
| src\routes\api\ess\aset-saya\+server.ts | 46 | peminjaman_barang_it | `kategori` | `kategori` | peminjaman_barang_it |
| src\routes\api\ess\aset-saya\+server.ts | 46 | peminjaman_barang_it | `kondisi` | `kondisi` | peminjaman_barang_it |
| src\routes\api\ess\aset-saya\+server.ts | 46 | peminjaman_barang_it | `kode` | `kode` | peminjaman_barang_it |
| src\routes\api\ess\aset-saya\+server.ts | 46 | peminjaman_barang_it | `qty` | `qty` | peminjaman_barang_it |
| src\routes\api\ess\aset-saya\+server.ts | 46 | peminjaman_barang_it | `nama` | `nama` | peminjaman_barang_it |
| src\routes\api\ess\aset-saya\+server.ts | 46 | peminjaman_barang_it | `mode_lacak` | `mode_lacak` | peminjaman_barang_it |
| src\routes\api\ess\aset-saya\+server.ts | 46 | peminjaman_barang_it | `lokasi_id.location_name` | `lokasi_id` | peminjaman_barang_it |
| src\routes\api\ess\attendance\izin-sakit\+server.ts | 285 | absensi_harian | `date_created` | `date_created` | absensi_harian |
| src\routes\api\ess\izin-jam\submit\+server.ts | 73 | izin_jam_request | `jumlah_hari` | `jumlah_hari` | izin_jam_request |
| src\routes\api\fleet-booking\[id]\+server.ts | 76 | fleet_drivers | `foto` | `foto` | fleet_drivers |
| src\routes\api\fleet-booking\+server.ts | 184 | fleet_kendaraan | `foto` | `foto` | fleet_kendaraan |
| src\routes\api\fleet-booking\+server.ts | 184 | fleet_kendaraan | `lokasi` | `lokasi` | fleet_kendaraan |
| src\routes\api\fleet-booking\+server.ts | 184 | fleet_kendaraan | `transmisi` | `transmisi` | fleet_kendaraan |
| src\routes\api\fleet-booking\+server.ts | 184 | fleet_kendaraan | `kapasitas` | `kapasitas` | fleet_kendaraan |
| src\routes\api\fleet-booking\+server.ts | 203 | fleet_drivers | `foto` | `foto` | fleet_drivers |
| src\routes\api\goods-received\list\+server.ts | 48 | surat_jalan | `manual_customer_name` | `manual_customer_name` | surat_jalan |
| src\routes\api\kiosk\fg-request\+server.ts | 62 | identitas_barang | `kode_barang` | `kode_barang` | identitas_barang |
| src\routes\api\kiosk\produksi\+server.ts | 246 | identitas_barang | `kode_barang` | `kode_barang` | identitas_barang |
| src\routes\api\manpower-leader\absen-regu\+server.ts | 91 | manpower_assignment | `date_created` | `date_created` | manpower_assignment |
| src\routes\api\manpower-leader\absen-regu\+server.ts | 244 | manpower_absensi | `manpower_id.rate_standby` | `rate_standby` | manpower |
| src\routes\api\manpower-leader\absen-regu\+server.ts | 244 | manpower_absensi | `manpower_id.rate_upah_harian` | `rate_upah_harian` | manpower |
| src\routes\api\manpower-leader\absen-regu\+server.ts | 244 | manpower_absensi | `manpower_id.rate_lembur` | `rate_lembur` | manpower |
| src\routes\api\procurement\vendor-suggest\+server.ts | 44 | master_supplier | `identitas_lengkap$` | `identitas_lengkap$` | master_supplier |
| src\routes\api\procurement\vendor-suggest\+server.ts | 48 | master_supplier | `kode_supplier$` | `kode_supplier$` | master_supplier |
| src\routes\api\sewa-masuk\gate\+server.ts | 50 | sewa_masuk | `reference_no` | `reference_no` | sewa_masuk |
| src\routes\api\sewa-masuk\gate\+server.ts | 50 | sewa_masuk | `project_id.nama_project` | `nama_project` | projects |
| src\routes\api\sewa-masuk\gate\+server.ts | 50 | sewa_masuk | `vendor_contact_id.nama` | `nama` | contact |
| src\routes\api\sj-manual\[id]\dokumen\+server.ts | 27 | surat_jalan | `manual_customer_name` | `manual_customer_name` | surat_jalan |
| src\routes\api\sj-manual\[id]\dokumen\+server.ts | 27 | surat_jalan | `is_manual` | `is_manual` | surat_jalan |
| src\routes\api\sj-manual\+server.ts | 77 | surat_jalan | `manual_customer_name` | `manual_customer_name` | surat_jalan |

## Filter Numerik (_lt/_lte/_gt/_gte) pada Kolom string/text (1)

| File | Baris | Koleksi | Kolom | Tipe |
|---|---:|---|---|---|
| src\lib\server\kioskGudang.ts | 320 | identitas_barang | `stok_tersedia` | string |

## Tidak Bisa Diverifikasi (200)

_Koleksi/relasi tidak terbaca dari Directus (403/tidak ada) — perlu verifikasi manual lewat proxy aplikasi._

| File | Baris | Koleksi | Field Path | Alasan |
|---|---:|---|---|---|
| src\lib\server\aiConversations.ts | 81 | ai_conversations | `last_message_at` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\server\aiConversations.ts | 81 | ai_conversations | `date_created` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\server\aiConversations.ts | 107 | ai_chat_log | `attachments` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\server\aiConversations.ts | 107 | ai_chat_log | `created_at` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\server\aiConversations.ts | 107 | ai_chat_log | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\server\aiConversations.ts | 107 | ai_chat_log | `role` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\server\aiConversations.ts | 107 | ai_chat_log | `content` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\server\aiToolExecutors.ts | 333 | pm_due_tracker | `pm_task_template_id.task_name` | koleksi relasi "pm_task_template" tidak terbaca |
| src\lib\server\grandPoLapangan.ts | 101 | grand_po_members | `memasok_member_id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\server\grandPoLapangan.ts | 142 | so_customer_details | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\server\grandPoLapangan.ts | 142 | so_customer_details | `so_customer_id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\server\grandPoLapangan.ts | 142 | so_customer_details | `product_id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\server\grandPoLapangan.ts | 142 | so_customer_details | `nama_barang` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\server\grandPoLapangan.ts | 142 | so_customer_details | `qty` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\server\grandPoLapangan.ts | 142 | so_customer_details | `jumlah_pcs` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\server\grandPoLapangan.ts | 142 | so_customer_details | `packing` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\server\grandPoLapangan.ts | 142 | so_customer_details | `input_unit` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\server\grandPoLapangan.ts | 180 | project_coating_log | `satuan` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\server\grandPoLapangan.ts | 180 | project_coating_log | `qty_used` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\server\grandPoLapangan.ts | 180 | project_coating_log | `product_id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\server\grandPoLapangan.ts | 180 | project_coating_log | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\manpowerAbsensi.ts | 115 | manpower_absensi | `dobel_proyek_proyek_lain_id.id` | koleksi relasi "dobel_proyek_proyek_lain_id" tidak terbaca |
| src\lib\services\manpowerAbsensi.ts | 115 | manpower_absensi | `dobel_proyek_proyek_lain_id.name` | koleksi relasi "dobel_proyek_proyek_lain_id" tidak terbaca |
| src\lib\services\manpowerLeader.ts | 216 | overtime_request | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\manpowerLeader.ts | 216 | overtime_request | `manpower_id.nama` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\manpowerLeader.ts | 247 | overtime_request | `manpower_id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\masterObjekApi.ts | 30 | master_objek | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\packingList.ts | 1318 | packing_returns | `date_created` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\packingList.ts | 1318 | packing_returns | `leader_notes` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\packingList.ts | 1318 | packing_returns | `submitted_by` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\packingList.ts | 1318 | packing_returns | `condition_notes` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\persiapanProgress.ts | 44 | persiapan_progress | `catatan` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\persiapanProgress.ts | 44 | persiapan_progress | `date_updated` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\persiapanProgress.ts | 146 | persiapan_progress | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\persiapanProgress.ts | 146 | persiapan_progress | `status` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\persiapanProgress.ts | 146 | persiapan_progress | `revision_count` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\phoneDeposit.ts | 85 | phone_deposit_log | `status` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\phoneDeposit.ts | 102 | phone_deposit_log | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\phoneDeposit.ts | 102 | phone_deposit_log | `deposit_time` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\phoneDeposit.ts | 102 | phone_deposit_log | `locker_code` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\phoneDeposit.ts | 102 | phone_deposit_log | `karyawan_id.divisi` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\phoneDeposit.ts | 102 | phone_deposit_log | `karyawan_id.nama_karyawan` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\phoneDeposit.ts | 102 | phone_deposit_log | `karyawan_id.id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\phoneDeposit.ts | 128 | phone_deposit_log | `karyawan_id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\plDashboard.ts | 256 | pm_due_tracker | `status_id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\plDashboard.ts | 276 | pm_task_template | `task_name` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\plDashboard.ts | 276 | pm_task_template | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\preventive.ts | 164 | p2h_log | `numeric_value` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\preventive.ts | 605 | pm_task_template | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\preventive.ts | 605 | pm_task_template | `task_name` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\pricingApi.ts | 108 | pricing_tier_price | `harga_net` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\pricingApi.ts | 139 | pricing_tier_price | `berlaku_sampai` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\pricingApi.ts | 139 | pricing_tier_price | `berlaku_mulai` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\pricingApi.ts | 212 | so_customer_details | `so_customer_id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\pricingApi.ts | 212 | so_customer_details | `date_created` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\pricingApi.ts | 212 | so_customer_details | `qty` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\pricingApi.ts | 212 | so_customer_details | `harga_satuan` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\pricingApi.ts | 212 | so_customer_details | `nama_barang` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\pricingApi.ts | 233 | pricing_tier | `nama_tier` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\procurementApi.ts | 99 | items_pengajuan | `harga` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\procurementApi.ts | 99 | items_pengajuan | `units` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\procurementApi.ts | 99 | items_pengajuan | `quantity` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\procurementApi.ts | 139 | pengajuan | `item_pengajuan.quantity` | koleksi relasi "item_pengajuan" tidak terbaca |
| src\lib\services\procurementApi.ts | 139 | pengajuan | `item_pengajuan.harga` | koleksi relasi "item_pengajuan" tidak terbaca |
| src\lib\services\procurementApi.ts | 279 | purchase_orders_supplier | `shipping_tracking_no` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\procurementApi.ts | 279 | purchase_orders_supplier | `shipping_provider` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\procurementApi.ts | 279 | purchase_orders_supplier | `supplier_confirmed_at` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\procurementApi.ts | 279 | purchase_orders_supplier | `payment_terms` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\procurementApi.ts | 279 | purchase_orders_supplier | `eta_source` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\procurementApi.ts | 279 | purchase_orders_supplier | `delivery_date` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\procurementApi.ts | 279 | purchase_orders_supplier | `total_amount` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\procurementApi.ts | 279 | purchase_orders_supplier | `status` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\procurementApi.ts | 279 | purchase_orders_supplier | `supplier_name` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\procurementApi.ts | 279 | purchase_orders_supplier | `po_date` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\procurementApi.ts | 279 | purchase_orders_supplier | `po_number` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\procurementApi.ts | 279 | purchase_orders_supplier | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\procurementApi.ts | 342 | goods_receipt_notes | `status` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\procurementApi.ts | 349 | purchase_returns | `status` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\procurementApi.ts | 382 | purchase_order_supplier_items | `received_qty` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\procurementApi.ts | 382 | purchase_order_supplier_items | `unit` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\procurementApi.ts | 382 | purchase_order_supplier_items | `quantity` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\procurementApi.ts | 382 | purchase_order_supplier_items | `item_name` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\procurementApi.ts | 382 | purchase_order_supplier_items | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\projectAktualisasiApi.ts | 542 | purchase_order_supplier_items | `unit_price` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\projectContract.ts | 181 | contract_registry | `project_id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\projectContract.ts | 181 | contract_registry | `tanggal_berakhir` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\projectContract.ts | 181 | contract_registry | `status` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\projectContract.ts | 205 | contract_registry | `pihak_2` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\projectContract.ts | 205 | contract_registry | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\projectContract.ts | 205 | contract_registry | `pihak_2_ref_id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\projectContract.ts | 205 | contract_registry | `judul` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\projectStockInventoryApi.ts | 268 | identitas_barang | `sub_category.nama_sub` | koleksi relasi "sub_category" tidak terbaca |
| src\lib\services\projectStockInventoryApi.ts | 332 | surat_jalan_internal | `reference_no` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\projectStockInventoryApi.ts | 332 | surat_jalan_internal | `keperluan` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\projectStockInventoryApi.ts | 332 | surat_jalan_internal | `date_created` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\projectStockInventoryApi.ts | 332 | surat_jalan_internal | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\projectStockInventoryApi.ts | 355 | sj_manual | `penerima_tujuan` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\projectStockInventoryApi.ts | 355 | sj_manual | `date_created` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\projectStockInventoryApi.ts | 355 | sj_manual | `nomor_sj` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\projectStockInventoryApi.ts | 355 | sj_manual | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\qcInProcessApi.ts | 40 | qc_spec | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\qcInProcessApi.ts | 40 | qc_spec | `parameter` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\qcInProcessApi.ts | 40 | qc_spec | `satuan` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\qcInProcessApi.ts | 40 | qc_spec | `min_value` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\qcInProcessApi.ts | 40 | qc_spec | `max_value` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\qcInProcessApi.ts | 40 | qc_spec | `target_value` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\quickUpdateApi.ts | 66 | project_quick_updates | `project_id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\quickUpdateApi.ts | 66 | project_quick_updates | `author_uid` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\quickUpdateApi.ts | 66 | project_quick_updates | `author_name` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\quickUpdateApi.ts | 66 | project_quick_updates | `text` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\quickUpdateApi.ts | 66 | project_quick_updates | `ai_generated` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\quickUpdateApi.ts | 66 | project_quick_updates | `photo` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\quickUpdateApi.ts | 66 | project_quick_updates | `date_created` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\rndField.ts | 236 | identitas_barang | `sub_category.nama_sub` | koleksi relasi "sub_category" tidak terbaca |
| src\lib\services\rndField.ts | 254 | rnd_material_profile | `inkompatibilitas_tags` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\rndField.ts | 254 | rnd_material_profile | `catatan_aplikasi` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\rndField.ts | 254 | rnd_material_profile | `deskripsi_tds` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\rndField.ts | 254 | rnd_material_profile | `karakteristik_film` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\rndField.ts | 254 | rnd_material_profile | `sifat_fisik` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\rndField.ts | 375 | identitas_barang | `sub_category.kode_singkat` | koleksi relasi "sub_category" tidak terbaca |
| src\lib\services\rndField.ts | 382 | rnd_compatibility_rules | `alasan` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\rndField.ts | 382 | rnd_compatibility_rules | `hasil` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\rndField.ts | 382 | rnd_compatibility_rules | `tag_b` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\rndField.ts | 382 | rnd_compatibility_rules | `tag_a` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\rndFieldLogs.ts | 69 | qc_retained_samples | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\rndFieldLogs.ts | 69 | qc_retained_samples | `site` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\rndFieldLogs.ts | 69 | qc_retained_samples | `status` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\rndFieldLogs.ts | 69 | qc_retained_samples | `expiry_date` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\rndFieldLogs.ts | 69 | qc_retained_samples | `tanggal_simpan` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\rndFieldLogs.ts | 69 | qc_retained_samples | `lokasi_simpan` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\rndFieldLogs.ts | 69 | qc_retained_samples | `batch_no` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\rndFieldLogs.ts | 116 | rnd_weathering_logs | `pengamatan` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\rndFieldLogs.ts | 116 | rnd_weathering_logs | `kondisi_cuaca` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\rndFieldLogs.ts | 116 | rnd_weathering_logs | `tanggal_observasi` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\rndFieldLogs.ts | 116 | rnd_weathering_logs | `nama_panel` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\rndFieldLogs.ts | 116 | rnd_weathering_logs | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\sales.ts | 378 | visit_sales | `verifikasi_status` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\sales.ts | 378 | visit_sales | `tanggal_kunjungan` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 121 | security_patrol_route | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 121 | security_patrol_route | `shift` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 121 | security_patrol_route | `interval_menit` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 121 | security_patrol_route | `status` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 121 | security_patrol_route | `checkpoint_ids` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 121 | security_patrol_route | `name` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 186 | security_patrol_schedule | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 186 | security_patrol_schedule | `hari` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 186 | security_patrol_schedule | `route_id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 186 | security_patrol_schedule | `tanggal` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 186 | security_patrol_schedule | `setiap_hari` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 186 | security_patrol_schedule | `jam_ronda` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 186 | security_patrol_schedule | `shift` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 305 | security_gate_person_log | `manpower_id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 305 | security_gate_person_log | `waktu` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 305 | security_gate_person_log | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 305 | security_gate_person_log | `karyawan_id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 305 | security_gate_person_log | `nama_manual` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 342 | security_gate_goods_log | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 342 | security_gate_goods_log | `deskripsi` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 342 | security_gate_goods_log | `expected_return` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 342 | security_gate_goods_log | `pembawa_nama` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 372 | security_visitor | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 372 | security_visitor | `nama` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 372 | security_visitor | `checkin` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 372 | security_visitor | `tujuan_pic` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\security.ts | 372 | security_visitor | `instansi` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopDeliveryApi.ts | 323 | so_customer_details | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopDeliveryApi.ts | 323 | so_customer_details | `nama_barang` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopDeliveryApi.ts | 323 | so_customer_details | `qty` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopDeliveryApi.ts | 323 | so_customer_details | `harga_satuan` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopDeliveryApi.ts | 323 | so_customer_details | `total` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopDeliveryApi.ts | 323 | so_customer_details | `item_id.nama_barang_lengkap` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopDeliveryApi.ts | 323 | so_customer_details | `item_id.satuan` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopDeliveryApi.ts | 328 | so_customer_details | `so_detail_id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopDeliveryApi.ts | 328 | so_customer_details | `luasan_m2` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopDeliveryApi.ts | 328 | so_customer_details | `total_harga` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopOpsApi.ts | 148 | so_customer_details | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopOpsApi.ts | 148 | so_customer_details | `so_customer_id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopOpsApi.ts | 148 | so_customer_details | `nama_barang` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopOpsApi.ts | 148 | so_customer_details | `jenis_jasa` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopOpsApi.ts | 189 | workshop_report_po_detail | `second` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopOpsApi.ts | 189 | workshop_report_po_detail | `topcoat` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopOpsApi.ts | 189 | workshop_report_po_detail | `so_detail_id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopOpsApi.ts | 322 | workshop_report_po_detail | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopOpsApi.ts | 322 | workshop_report_po_detail | `subtask_name` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopOpsApi.ts | 322 | workshop_report_po_detail | `foto_urls` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopOpsApi.ts | 322 | workshop_report_po_detail | `laporan_id.tanggal` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopOpsApi.ts | 383 | ciketing_work_ticket | `date_created` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopOpsApi.ts | 383 | ciketing_work_ticket | `satuan` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopOpsApi.ts | 383 | ciketing_work_ticket | `qty_shipped` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopOpsApi.ts | 383 | ciketing_work_ticket | `qty_completed` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopOpsApi.ts | 383 | ciketing_work_ticket | `total_qty` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopOpsApi.ts | 383 | ciketing_work_ticket | `po_number` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopOpsApi.ts | 383 | ciketing_work_ticket | `status` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopOpsApi.ts | 383 | ciketing_work_ticket | `ticket_number` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\lib\services\workshopOpsApi.ts | 383 | ciketing_work_ticket | `id` | skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada) |
| src\routes\api\sj-manual\+server.ts | 77 | surat_jalan | `project_id.name` | koleksi relasi "project_id" tidak terbaca |
| src\routes\api\sji\[id]\+server.ts | 20 | sji_header | `gudang_id.nama_gudang` | koleksi relasi "gudang_id" tidak terbaca |
| src\routes\api\sji\[id]\dokumen\+server.ts | 45 | sji_header | `gudang_id.nama_gudang` | koleksi relasi "gudang_id" tidak terbaca |
| src\routes\api\sji\[id]\serahkan\+server.ts | 84 | sji_header | `gudang_id.nama_gudang` | koleksi relasi "gudang_id" tidak terbaca |
| src\routes\api\sji\+server.ts | 139 | sji_header | `gudang_id.nama_gudang` | koleksi relasi "gudang_id" tidak terbaca |
