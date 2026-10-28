// src/lib/config/fieldExportRegistry.ts
// Fase "Export Universal — Dashboard Lapangan" (§5.4 rencana).
//
// DAFTAR PUTIH (allow-list) section yang boleh diekspor Project Leader lapangan.
// BUKAN registry admin yang difilter — ini daftar TERPISAH. Section sensitif
// (HPP, EVM, margin/profitabilitas, nilai kontrak & termin, payroll) TIDAK PERNAH
// punya entri di sini, jadi tidak bisa "bocor karena lupa filter".
//
// Endpoint server `/api/export/project` juga menolak `section` di luar
// FIELD_EXPORT_SECTION_KEYS dengan 403 — pertahanan berlapis (§5.4 poin 2).

import type { FieldColumn, FieldExportOpts } from '$lib/services/fieldExportApi';
import {
	flattenInventoryForField,
	flattenStockLogForField,
	flattenTimelineForField,
	flattenLaporanHarianForField,
	flattenAbsensiForField,
	flattenPackingListForField,
	flattenPunchListForField,
	flattenLaporanHarianFotoForField
} from '$lib/services/fieldExportApi';

export interface FieldExportSection {
	key: string;
	label: string;
	/** ikon tabler (nama tanpa prefix Icon) sekadar hint UI */
	icon: string;
	formats: Array<'xlsx' | 'csv' | 'pdf'>;
	supportsDateRange: boolean;
	fetch: (projectId: number, opts?: FieldExportOpts) => Promise<Array<Record<string, unknown>>>;
	columns: FieldColumn[];
}

export const FIELD_EXPORT_SECTIONS: Record<string, FieldExportSection> = {
	inventory: {
		key: 'inventory',
		label: 'Inventaris Proyek',
		icon: 'box',
		formats: ['xlsx', 'csv', 'pdf'],
		supportsDateRange: false,
		fetch: flattenInventoryForField,
		columns: [
			{ header: 'Nama Barang', key: 'namaBarang' },
			{ header: 'Kode', key: 'kodeItem' },
			{ header: 'Satuan', key: 'satuan' },
			{ header: 'Kategori', key: 'category' },
			{ header: 'Sisa di Tangan', key: 'qtyOnHand', type: 'number' },
			{ header: 'Diterima', key: 'qtyReceived', type: 'number' },
			{ header: 'Terpakai', key: 'qtyUsed', type: 'number' },
			{ header: 'Rusak', key: 'qtyDamaged', type: 'number' },
			{ header: 'Dikembalikan', key: 'qtyReturned', type: 'number' },
			{ header: 'Gerakan Terakhir', key: 'lastMovementDate', type: 'date' }
		]
	},
	'stock-log': {
		key: 'stock-log',
		label: 'Log Mutasi Barang',
		icon: 'arrows-exchange',
		formats: ['xlsx', 'csv', 'pdf'],
		supportsDateRange: true,
		fetch: flattenStockLogForField,
		columns: [
			{ header: 'Tanggal', key: 'date', type: 'date' },
			{ header: 'Nama Barang', key: 'namaBarang' },
			{ header: 'Satuan', key: 'satuan' },
			{ header: 'Arah', key: 'type' },
			{ header: 'Kondisi', key: 'conditionStatus' },
			{ header: 'Qty', key: 'qty', type: 'number' },
			{ header: 'No. Surat Jalan', key: 'suratJalanRef' },
			{ header: 'No. Referensi', key: 'refNo' },
			{ header: 'Sumber', key: 'source' },
			{ header: 'Catatan', key: 'notes' }
		]
	},
	timeline: {
		key: 'timeline',
		label: 'Timeline & Fase (WBS)',
		icon: 'timeline',
		formats: ['xlsx', 'csv', 'pdf'],
		supportsDateRange: false,
		fetch: flattenTimelineForField,
		columns: [
			{ header: 'Level', key: 'level', type: 'number' },
			{ header: 'Pekerjaan', key: 'name' },
			{ header: 'Status', key: 'status' },
			{ header: 'Bobot (%)', key: 'weight_pct', type: 'number' },
			{ header: 'Progress (%)', key: 'completion_pct', type: 'number' }
		]
	},
	'laporan-harian': {
		key: 'laporan-harian',
		label: 'Laporan Harian',
		icon: 'clipboard-text',
		formats: ['xlsx', 'csv', 'pdf'],
		supportsDateRange: true,
		fetch: flattenLaporanHarianForField,
		columns: [
			{ header: 'Tanggal', key: 'tanggal', type: 'date' },
			{ header: 'Cuaca', key: 'cuaca' },
			{ header: 'Pekerjaan Dilakukan', key: 'pekerjaan_dilakukan' },
			{ header: 'Kendala', key: 'kendala' },
			{ header: 'Jumlah Pekerja', key: 'jumlah_pekerja', type: 'number' },
			{ header: 'Progress (%)', key: 'progress', type: 'number' },
			{ header: 'Status', key: 'status' }
		]
	},
	absensi: {
		key: 'absensi',
		label: 'Absensi & Kehadiran Site',
		icon: 'user-check',
		formats: ['xlsx', 'csv', 'pdf'],
		supportsDateRange: true,
		fetch: flattenAbsensiForField,
		columns: [
			{ header: 'Tanggal', key: 'tanggal', type: 'date' },
			{ header: 'ID Manpower', key: 'manpower_id', type: 'number' },
			{ header: 'Status', key: 'status' }
		]
	},
	'packing-list': {
		key: 'packing-list',
		label: 'Packing List',
		icon: 'package',
		formats: ['xlsx', 'csv', 'pdf'],
		supportsDateRange: false,
		fetch: flattenPackingListForField,
		columns: [
			// TANPA kolom harga — hanya kuantitas & status (§5.4 P2).
			{ header: 'Material', key: 'material_name' },
			{ header: 'Warna', key: 'material_color' },
			{ header: 'Kategori', key: 'category_label' },
			{ header: 'Qty', key: 'qty', type: 'number' },
			{ header: 'Satuan', key: 'unit' },
			{ header: 'Qty Dikirim', key: 'qty_sudah_dikirim', type: 'number' },
			{ header: 'Status Packing', key: 'packing_status' },
			{ header: 'Status Pick', key: 'pick_status' },
			{ header: 'PIC', key: 'pic' },
			{ header: 'Dibuat', key: 'date_created', type: 'date' }
		]
	},
	'laporan-harian-foto': {
		key: 'laporan-harian-foto',
		label: 'Foto Laporan Harian',
		icon: 'photo',
		formats: ['pdf'], // grid foto di-render server (Gotenberg) — bukan tabel
		supportsDateRange: true,
		fetch: flattenLaporanHarianFotoForField,
		columns: [
			{ header: 'Tanggal', key: 'tanggal', type: 'date' },
			{ header: 'Kategori', key: 'kategori' },
			{ header: 'Keterangan', key: 'keterangan' },
			{ header: 'fileId', key: 'fileId' }
		]
	},
	'punch-list': {
		key: 'punch-list',
		label: 'Quality / Punch List',
		icon: 'checkbox',
		formats: ['xlsx', 'csv', 'pdf'],
		supportsDateRange: false,
		fetch: flattenPunchListForField,
		columns: [
			{ header: 'No. Punch', key: 'punch_no' },
			{ header: 'Deskripsi', key: 'description' },
			{ header: 'Area/Lokasi', key: 'lokasi_area' },
			{ header: 'Severity', key: 'severity' },
			{ header: 'Status', key: 'status' },
			{ header: 'Tenggat', key: 'tenggat', type: 'date' },
			{ header: 'Dibuat', key: 'date_created', type: 'date' }
		]
	}
};

export const FIELD_EXPORT_SECTION_KEYS = Object.keys(FIELD_EXPORT_SECTIONS);

export function getFieldExportSection(key: string): FieldExportSection | null {
	return FIELD_EXPORT_SECTIONS[key] ?? null;
}

export function listFieldExportSections(): FieldExportSection[] {
	return Object.values(FIELD_EXPORT_SECTIONS);
}
