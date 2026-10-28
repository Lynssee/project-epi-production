// src/lib/server/sjManualFields.ts
// SJ Manual dari lapangan — pemetaan ke kolom surat_jalan yang BENAR-BENAR ada di Directus live.
//
// Kode lama menulis/membaca kolom is_manual, manual_customer_name, manual_customer_address, manual_customer_phone,
// manual_notes, delivery_items — TIDAK ADA di skema live (membaca = 403; menulis = nilainya hilang). Tidak ada satu pun
// baris yang pernah terbentuk lewat jalur ini. Penanda SJ manual di skema live = surat_jalan.type = 'manual'
// (dipakai alur Urgent Dispatch admin), dan item berada di tabel surat_jalan_items (bukan JSON).
//
//   penanda        : type = 'manual'
//   alamat tujuan  : delivery_address
//   nama tujuan    : baris pertama notes   →  "[SJ MANUAL] Tujuan: <nama> | Telp: <telp>"
//   catatan        : sisa notes (setelah baris pertama)
//   item           : surat_jalan_items (nama_barang, qty_required, unit, keterangan)
//
// Tidak butuh perubahan skema. Bila kelak kolom manual_* dibuat, cukup ubah modul ini.

export const SJ_MANUAL_TYPE = 'manual';
const HEADER_RE = /^\[SJ MANUAL\] Tujuan: (.*?) \| Telp: (.*)$/;

export function composeManualNotes(customerName: string, customerPhone: string | null | undefined, notes: string | null | undefined): string {
	const head = `[SJ MANUAL] Tujuan: ${customerName.trim()} | Telp: ${(customerPhone || '').trim() || '-'}`;
	const rest = (notes || '').trim();
	return rest ? `${head}\n${rest}` : head;
}

export function parseManualNotes(raw: string | null | undefined): { customerName: string; customerPhone: string; notes: string } {
	const text = String(raw || '');
	const [first, ...others] = text.split('\n');
	const m = HEADER_RE.exec(first || '');
	if (!m) return { customerName: '', customerPhone: '', notes: text };
	return {
		customerName: m[1].trim(),
		customerPhone: m[2].trim() === '-' ? '' : m[2].trim(),
		notes: others.join('\n').trim()
	};
}

/** Baris surat_jalan → bentuk lama (manual_*) yang masih dipakai halaman lapangan, tanpa mengubah UI. */
export function toLegacyHeader<T extends Record<string, any>>(row: T): T & {
	is_manual: boolean;
	manual_customer_name: string | null;
	manual_customer_address: string | null;
	manual_customer_phone: string | null;
	manual_notes: string | null;
} {
	const p = parseManualNotes(row?.notes);
	return {
		...row,
		is_manual: row?.type === SJ_MANUAL_TYPE,
		manual_customer_name: p.customerName || null,
		manual_customer_address: row?.delivery_address ?? null,
		manual_customer_phone: p.customerPhone || null,
		manual_notes: p.notes || null
	};
}

export interface SjManualItemRow {
	item_id: number | null;
	nama_barang: string;
	qty: number;
	satuan: string;
	notes: string;
}

/** Item masukan form → baris surat_jalan_items. Hanya kolom yang terverifikasi ada di skema live. */
export function toSuratJalanItemRows(sjId: number, items: Array<{ namaBarang: string; qty: number; satuan?: string; notes?: string }>) {
	return items.map((it) => ({
		surat_jalan_id: sjId,
		nama_barang: it.namaBarang,
		qty_required: Number(it.qty) || 0,
		qty_remaining: Number(it.qty) || 0,
		unit: it.satuan || 'PCS',
		keterangan: it.notes || '',
		so_type: 'manual'
	}));
}

/** Baris surat_jalan_items → bentuk item lama (nama_barang, qty, satuan, notes) untuk halaman lapangan. */
export function fromSuratJalanItemRows(rows: any[]): SjManualItemRow[] {
	return (rows || []).map((r) => ({
		item_id: null,
		nama_barang: r.nama_barang,
		qty: Number(r.qty_required) || 0,
		satuan: r.unit || 'PCS',
		notes: r.keterangan || ''
	}));
}
