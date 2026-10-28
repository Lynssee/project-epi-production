// src/lib/services/inventorySettings.ts
// Modul pembaca system_settings namespace inventory.* (Inventory Lapangan v2.0, Bab 7).
// Satu modul pembaca per dashboard — komponen TIDAK boleh menembak Directus sendiri untuk setelan ini.
// Aturan Bab 7: setiap kunci wajib punya default di kode (Directus tak terjangkau/kunci belum ada -> tetap
// jalan dengan default, tidak error, tidak blank); cache in-memory ~5 menit; ada tombol "muat ulang setelan".

import { writable, get } from 'svelte/store';
import directus, { handleDirectusError } from './directus';
import { readItems } from '@directus/sdk';

const NAMESPACE = 'inventory.';
const CACHE_TTL_MS = 5 * 60 * 1000;

export type InventorySettingsMap = Record<string, any>;

// Default bawaan — nilai sudah dalam tipe JS asli, sama persis dengan erp-epi-1/src/lib/services/inventorySettings.js
// (kedua dashboard baca kunci yang sama dari koleksi system_settings yang sama).
export const INVENTORY_SETTINGS_DEFAULTS: InventorySettingsMap = {
	'inventory.alert.low_stock_threshold_pct': 20,
	'inventory.alert.consumable_days': 7,
	'inventory.alert.notif_channel': 'wa',
	'inventory.scan.require_photo_on_usage': false,
	'inventory.scan.require_gps_on_usage': true,
	'inventory.scan.accept_external_barcode': true,
	'inventory.scan.allow_field_registration': false,
	'inventory.scan.fallback_manual': true,
	'inventory.scan.label_format': { size: 'A4', codes: ['qr', 'code128'], fields: ['kode_item', 'nama_barang'] },
	'inventory.packing.require_item_master': true,
	'inventory.packing.auto_suggest': false,
	'inventory.packing.shortage_tolerance_pct': 0,
	'inventory.opname.frequency_days': 30,
	'inventory.opname.fefo_enabled': false,
	'inventory.alat.overdue_alert_days': 3,
	// RSM-07 §4.2: kategori induk yang otomatis dicatat sebagai ALAT pinjaman saat dikirim ke proyek
	'inventory.alat.kategori_induk': ['EQUIPMENT', 'KENDARAAN', 'COMPRESSOR', 'AIRLESS'],
	// RSM-11 §4.1: kapan barang SJ dianggap DITERIMA proyek (IN-RECEIPT ledger + is_received biaya).
	//   saat_sj_dibuat  = perilaku lama (default, tidak mengubah operasional — Aturan #3)
	//   otomatis_gerbang = saat satpam meloloskan SJ   |   konfirmasi_leader = saat leader konfirmasi terima di site
	// Mode selain default menunda penerimaan; batas_hari = bila leader tak konfirmasi, otomatis dianggap diterima.
	'inventory.terima_site.mode': 'saat_sj_dibuat',
	'inventory.terima_site.batas_hari': 3,
	// RSM-05 §4.3: jenis biaya yang BUKAN barang fisik -> tidak ikut daftar retur (cocok dengan project_expenses.expense_type)
	'inventory.retur.kategori_dikecualikan': ['jasa', 'operasional', 'man_power'],
	'inventory.pilot.project_ids': [],
	'inventory.pilot.gudang_ids': [],
	'inventory.pilot.pic_names': [],
	'inventory.ui.items_per_page': 50,
	'inventory.ui.search_debounce_ms': 500,
	// Surat Jalan Internal v2 (Rencana-Implementasi-SJ-Internal-v2-manual.md, K4)
	'inventory.sji.enabled': false,
	'inventory.sji.format_nomor': 'SJI/{YY}{MM}/{NNNN}',
	'inventory.sji.tipe_options': ['ambil_pakai', 'pinjam'],
	'inventory.sji.urgency_options': ['normal', 'urgent'],
	'inventory.sji.auto_approve_max_nilai': 0,
	'inventory.sji.auto_approve_kategori': [],
	'inventory.sji.approver_mode': 'gudang',
	'inventory.sji.default_deadline_hari': 7,
	'inventory.sji.require_photo_serah': true,
	'inventory.sji.require_photo_kembali': true,
	'inventory.sji.require_gps': false,
	'inventory.sji.require_ttd': true,
	'inventory.sji.reminder_hari_sebelum': 1,
	'inventory.sji.denda_per_hari': 0,
	'inventory.sji.kondisi_kembali_options': ['baik', 'rusak', 'hilang'],
	'inventory.sji.field_boleh_ajukan_roles': [],
	'inventory.sji.notif_wa_enabled': false,
	// Gudang Pusat Bojongkulur v2 (implementation_plan_gudang-pusat-bojongkulur.md, Fase 0)
	'inventory.gudang_hq.enabled': false,
	'inventory.gudang_hq.gudang_ids': [1],
	'inventory.gudang_hq.sumber_task': ['packing_list'],
	'inventory.gudang_hq.wajib_foto_pick': true,
	'inventory.gudang_hq.wajib_gps': false,
	'inventory.gudang_hq.boleh_kirim_sebagian': true,
	'inventory.gudang_hq.toleransi_selisih_pct': 0,
	'inventory.gudang_hq.opname_wajib_approval': true,
	'inventory.gudang_hq.max_item_per_task': 50,
	'inventory.gudang_hq.notif_enabled': false,
	'inventory.gudang_hq.notif_channel': 'wa',
	'inventory.gudang_hq.notif_penerima_ids': [],
	'inventory.gudang_hq.threshold_stok_rendah_pct': 20,
	'inventory.gudang_hq.jadwal_opname_cron': '0 8 * * 1',
	// Hub Persiapan 3-Lajur v2 (implementation_plan_pertajam UIUX navigasi mobile inventory, Fase 0)
	'inventory.persiapan.hub_enabled': true,
	'inventory.persiapan.wajib_foto_bukti': true,
	'inventory.persiapan.boleh_partial': true,
	'inventory.persiapan.internal_department_values': '',
	'inventory.persiapan.auto_surat_jalan': false,
	// Fase 1-4 (Rencana Sistem Penempatan Area Inventory & Verifikasi Barcode v2, 20 Agu 2026, K5):
	// menumpang namespace area_tracking yang sudah ada. Sama persis dengan erp-epi-1.
	'inventory.area_tracking.verifikasi_wajib_foto': false,
	'inventory.area_tracking.toleransi_selisih_pct': 5,
	'inventory.area_tracking.sla_diskrepansi_jam': 48,
	'inventory.area_tracking.interval_verifikasi_hari': 7,
	'inventory.area_tracking.severity_rule': { kurang_lebih_dari_pct: 20, tidak_ada: 'high', salah_item: 'medium', rusak: 'high' },
	// ── Lifecycle Pengembalian Barang v2 (Fase 0, 25 Sep 2026). Sama persis dengan erp-epi-1
	// (src/lib/services/inventorySettings.js) -- dipakai Fase 3 untuk klasifikasi Kebijakan
	// Kembali di Mode Demobilisasi (tutup massal HABIS_PAKAI di bawah ambang).
	'inventory.retur.policy_map': {},
	'inventory.retur.batch_close_threshold_idr': 50000,
	// Siapa yang menerbitkan surat jalan retur proyek (2 Okt 2026). 'inventory' = leader hanya
	// mengajukan, tim Inventory yang membuat surat jalan pengambilan; 'lapangan' = perilaku lama,
	// dokumen RTN dibuat otomatis berstatus "dikirim" saat leader submit. Sama persis dengan erp-epi.
	'inventory.retur.penerbit_surat_jalan': 'inventory',
	'inventory.retur.sla.proyek_kirim_ke_terima_hari': 3,
	'inventory.retur.sla.proyek_return_requested_tanpa_kirim_hari': 7,
	'inventory.retur.sla.pinjaman_overdue_hari': 0,
	'inventory.retur.sla.customer_pending_hari': 3,
	'inventory.retur.sla.bengkel_hari': 14,
	// ── Inventory 360° Knowledge Hub (Fase 4, 26 Okt 2026). Sama persis dgn erp-epi
	// (src/lib/services/inventorySettings.js). Lapangan hanya MEMBACA: konteks kartu yang aktif (matikan satu tanpa deploy).
	'inventory.knowledge.touchpoint_aktif': ['purchase', 'receive', 'usage', 'maintenance', 'sales'],
	'inventory.knowledge.review_interval_hari': 180,
	'inventory.knowledge.ai_batch_limit_per_malam': 30,
	'inventory.knowledge.min_skor_verified_default': 70,
	'inventory.knowledge.tampilkan_harga_wajar': true,
	'inventory.knowledge.statistik_aktif': true,
	'inventory.knowledge.cetak_spek_di_dokumen': true
};

/** Store reaktif untuk komponen Svelte — selalu berisi default + override, tidak pernah kosong. */
export const inventorySettingsStore = writable<InventorySettingsMap>({ ...INVENTORY_SETTINGS_DEFAULTS });

let cache: InventorySettingsMap | null = null;
let cachedAt = 0;
let inflight: Promise<InventorySettingsMap> | null = null;

function parseValue(setting_type: string, raw: string | null | undefined, fallback: any): any {
	if (raw == null) return fallback;
	try {
		switch (setting_type) {
			case 'number':
				return Number(JSON.parse(raw));
			case 'boolean':
				return Boolean(JSON.parse(raw));
			case 'json':
			case 'list':
			case 'enum':
				return JSON.parse(raw);
			default:
				try {
					return JSON.parse(raw);
				} catch {
					return raw;
				}
		}
	} catch (err) {
		console.warn(`[inventorySettings] Gagal parse "${raw}", pakai default.`, err);
		return fallback;
	}
}

/**
 * Muat setelan inventory.* dari Directus. Aman dipanggil berkali-kali — di-cache 5 menit
 * dan gagal-lunak ke default bila Directus tak terjangkau.
 * @param force - lewati cache (dipakai tombol "muat ulang setelan")
 */
export async function loadInventorySettings(force = false): Promise<InventorySettingsMap> {
	const now = Date.now();
	if (!force && cache && now - cachedAt < CACHE_TTL_MS) return cache;
	if (inflight) return inflight;

	inflight = (async () => {
		const merged: InventorySettingsMap = { ...INVENTORY_SETTINGS_DEFAULTS };
		try {
			const rows = await directus.request(
				readItems('system_settings' as any, {
					filter: { setting_key: { _starts_with: NAMESPACE } } as any,
					limit: -1
				})
			);
			for (const row of rows as any[]) {
				const key = row.setting_key;
				if (!(key in merged)) continue; // kunci tak dikenal diabaikan, bukan error
				merged[key] = parseValue(row.setting_type, row.setting_value, INVENTORY_SETTINGS_DEFAULTS[key]);
			}
		} catch (err) {
			console.warn('[inventorySettings] Directus tak terjangkau — pakai default.', err);
			try {
				handleDirectusError(err);
			} catch {
				// sudah di-log di atas; tetap lanjut dengan default
			}
		}
		cache = merged;
		cachedAt = Date.now();
		inventorySettingsStore.set(merged);
		inflight = null;
		return merged;
	})();

	return inflight;
}

/** Baca satu kunci secara sinkron dari cache (atau default bila belum pernah dimuat). */
export function getInventorySetting(key: string): any {
	const source = cache || get(inventorySettingsStore) || INVENTORY_SETTINGS_DEFAULTS;
	return key in source ? source[key] : INVENTORY_SETTINGS_DEFAULTS[key];
}

/** Baca seluruh setelan inventory.* secara sinkron (default + override yang sudah dimuat). */
export function getAllInventorySettings(): InventorySettingsMap {
	return cache ? { ...cache } : { ...INVENTORY_SETTINGS_DEFAULTS };
}

/** Paksa muat ulang dari Directus. */
export function reloadInventorySettings(): Promise<InventorySettingsMap> {
	return loadInventorySettings(true);
}
