// src/lib/config/produksiExportAllowlist.ts
// Export Produksi v2 — Fase 4 (dashboard lapangan). §6.5 rencana:
// ALLOW-LIST TERPISAH — bukan registry ERP yang difilter. Bagian sensitif
// (HPP/biaya/margin/harga satuan) TIDAK PERNAH punya entri di sini, jadi tidak
// bisa "bocor karena lupa filter". Endpoint PDF memakai daftar `KEY` ini untuk
// menolak section rekayasa (403), dan flattener di bawah HANYA membawa kuantitas
// & satuan — nol rupiah.
//
// Dipakai bersama klien (ProduksiExportSheet.svelte) & server (api/export/produksi).

export type ProduksiExportKey = 'spk-berjalan' | 'log-harian' | 'semua-spk';

export interface ExportCol {
	key: string;
	label: string;
}

export interface ProduksiExportSection {
	key: ProduksiExportKey;
	label: string;
	/** Format yang ditawarkan di UI lapangan. PDF butuh koneksi (Gotenberg server). */
	formats: Array<'csv' | 'pdf'>;
	columns: ExportCol[];
}

const spkColumns: ExportCol[] = [
	{ key: 'nomor', label: 'No SPK' },
	{ key: 'batch_no', label: 'Batch' },
	{ key: 'produk', label: 'Produk' },
	{ key: 'status', label: 'Status' },
	{ key: 'total_kg', label: 'Total (Kg)' },
	{ key: 'qty_aktual', label: 'Qty Aktual' },
	{ key: 'deadline', label: 'Deadline' },
	{ key: 'dibuat', label: 'Dibuat' }
];

export const PRODUKSI_EXPORT_SECTIONS: Record<ProduksiExportKey, ProduksiExportSection> = {
	'spk-berjalan': {
		key: 'spk-berjalan',
		label: 'SPK Berjalan',
		formats: ['csv', 'pdf'],
		columns: spkColumns
	},
	'log-harian': {
		key: 'log-harian',
		label: 'Riwayat Log Harian',
		formats: ['csv', 'pdf'],
		columns: [
			{ key: 'tanggal', label: 'Tanggal' },
			{ key: 'nomor', label: 'No SPK' },
			{ key: 'produk', label: 'Produk' },
			{ key: 'output_kg', label: 'Output (Kg)' },
			{ key: 'reject_kg', label: 'Reject (Kg)' },
			{ key: 'waste_kg', label: 'Waste (Kg)' },
			{ key: 'catatan', label: 'Catatan' },
			{ key: 'input_by', label: 'Input Oleh' }
		]
	},
	'semua-spk': {
		key: 'semua-spk',
		label: 'Semua SPK (terfilter)',
		formats: ['csv'],
		columns: spkColumns
	}
};

export const PRODUKSI_EXPORT_KEYS: ProduksiExportKey[] = Object.keys(
	PRODUKSI_EXPORT_SECTIONS
) as ProduksiExportKey[];

export function isProduksiExportKey(v: unknown): v is ProduksiExportKey {
	return typeof v === 'string' && (PRODUKSI_EXPORT_KEYS as string[]).includes(v);
}

// --- kata kunci "harga" yang WAJIB tidak pernah lolos ke PDF lapangan (defense in depth) ---
const PRICE_HINT = /(harga|price|rupiah|\brp\b|hpp|margin|biaya|cost|nilai_?jual|subtotal|total_?harga)/i;
export function isPriceColumn(labelOrKey: string): boolean {
	return PRICE_HINT.test(labelOrKey || '');
}

// ------------------------------------------------------------------ flattener
// (scopeId diabaikan — lingkup konteks user. Null-safety wajib.)

function productTitle(p: any): string {
	if (!p) return '-';
	if (typeof p === 'object') return p.nama_barang_lengkap || p.kode_barang || 'Produk';
	return `Produk #${p}`;
}
function spkNo(spk: any): string {
	if (!spk) return '-';
	if (typeof spk === 'object') return spk.nomor || `#${spk.id}`;
	return `#${spk}`;
}
const d10 = (v: any) => String(v ?? '').slice(0, 10);
const num = (v: any) => (v == null ? 0 : Number(v) || 0);

export function flattenSpkForExport(rows: any[]): Array<Record<string, unknown>> {
	return (rows || []).map((s) => ({
		nomor: s?.nomor ?? '-',
		batch_no: s?.batch_no ?? '-',
		produk: productTitle(s?.product_id),
		status: s?.status ?? '-',
		total_kg: num(s?.total_kg),
		qty_aktual: num(s?.actual_quantity_produced ?? s?.jumlah_produksi),
		deadline: d10(s?.production_deadline ?? s?.target_selesai),
		dibuat: d10(s?.date_created)
	}));
}

export function flattenLogForExport(rows: any[]): Array<Record<string, unknown>> {
	return (rows || []).map((l) => ({
		tanggal: d10(l?.tanggal),
		nomor: spkNo(l?.spk_id),
		produk: typeof l?.spk_id === 'object' ? productTitle(l.spk_id?.product_id) : '-',
		output_kg: num(l?.output_kg),
		reject_kg: num(l?.reject_kg),
		waste_kg: num(l?.waste_kg),
		catatan: l?.catatan ?? '',
		input_by: l?.input_by ?? ''
	}));
}

/** Ratakan sesuai section-key. */
export function flattenForExport(
	key: ProduksiExportKey,
	rows: any[]
): Array<Record<string, unknown>> {
	if (key === 'log-harian') return flattenLogForExport(rows);
	return flattenSpkForExport(rows); // spk-berjalan & semua-spk
}
