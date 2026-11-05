// src/lib/utils/kioskPemakaian.ts
// Aturan murni Draf Pemakaian Barang kru (Rencana Kiosk Proyek, Fase 5). Dipakai server (validasi) & klien (impor).
//
// PENTING (cegah potong stok ganda): draf TIDAK menulis stok. Draf diimpor leader menjadi baris `material_used`
// di Laporan Harian; stok (project_expenses.qty_used + ledger OUT-USAGE) baru berubah saat laporan disimpan,
// lewat penulis yang sudah ada. Baris hasil impor diberi penanda "[kiosk#<id>]" di notes supaya saat simpan
// hanya draf yang barisnya MASIH ADA yang ditandai "dipakai".

export const PEMAKAIAN_MAKS_QTY = 1_000_000;
export const PEMAKAIAN_CATATAN_MAKS = 300;

/** Angka positif maks 3 desimal ("1,5" dan "1.5" sama-sama diterima). null = tidak valid. */
export function parseQty(raw: unknown): number | null {
	const s = String(raw ?? '').trim().replace(',', '.');
	if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
	const n = Number(s);
	return Number.isFinite(n) && n > 0 && n <= PEMAKAIAN_MAKS_QTY ? n : null;
}

export interface BarangProyek {
	expense_id: number;
	nama: string;
	satuan: string;
	sisa: number;
	identitas_barang_id: number | null;
}

/** Murni: dari baris project_expenses mentah → daftar barang yang masih punya sisa (urut nama). */
export function susunBarang(rows: Array<Record<string, any>> | null | undefined): BarangProyek[] {
	const out: BarangProyek[] = [];
	for (const r of rows || []) {
		const qty = parseFloat(r?.qty) || 0;
		const used = parseFloat(r?.qty_used) || 0;
		// Sama dengan getProjectActualMaterials: qty_remaining kosong → qty - qty_used.
		const sisa = r?.qty_remaining !== null && r?.qty_remaining !== undefined ? parseFloat(r.qty_remaining) : qty - used;
		if (!Number.isFinite(sisa) || sisa <= 0) continue;
		const idn = r?.identitas_barang_id && typeof r.identitas_barang_id === 'object' ? r.identitas_barang_id.id : r?.identitas_barang_id;
		out.push({
			expense_id: Number(r.id),
			nama: String(r.material_name || r.description || 'Item Tanpa Nama').trim(),
			satuan: String(r.unit || '').trim(),
			sisa: Math.round(sisa * 1000) / 1000,
			identitas_barang_id: Number.isFinite(Number(idn)) && Number(idn) > 0 ? Number(idn) : null
		});
	}
	return out.sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
}

export const tandaDraf = (id: number) => `[kiosk#${id}]`;

export interface DrafPemakaian {
	id: number;
	manpower_nama?: string | null;
	expense_id: number;
	identitas_barang_id: number | null;
	nama_barang: string;
	satuan: string | null;
	qty: number;
	catatan?: string | null;
}

export interface BarisMaterialUsed {
	type: string;
	amount: number;
	unit: string;
	notes: string;
	expense_id: string;
	identitas_barang_id: number | null;
	is_manual: boolean;
}

/** Satu draf → satu baris material_used (bentuk sama dengan baris yang diketik leader, bukan manual). */
export function drafKeBaris(d: DrafPemakaian): BarisMaterialUsed {
	const dari = (d.manpower_nama || 'Kru').trim();
	const cat = (d.catatan || '').trim().replace(/\s+/g, ' ');
	return {
		type: d.nama_barang,
		amount: Number(d.qty),
		unit: d.satuan || 'kg',
		notes: `${tandaDraf(d.id)} ${dari}${cat ? `: ${cat}` : ''}`,
		expense_id: String(d.expense_id),
		identitas_barang_id: d.identitas_barang_id ?? null,
		is_manual: false
	};
}

const barisKosong = (m: Partial<BarisMaterialUsed> | null | undefined) =>
	!m || (!(m.type || '').trim() && !m.expense_id && !(Number(m.amount) > 0) && !(m.notes || '').trim());

/** Tambahkan baris hasil impor; baris kosong bawaan form dibuang, draf yang sudah ada barisnya tidak diulang. */
export function gabungMaterialUsed<T extends Partial<BarisMaterialUsed>>(existing: T[] | null | undefined, drafs: DrafPemakaian[]): Array<T | BarisMaterialUsed> {
	const ada = (existing || []).filter((m) => !barisKosong(m));
	const sudah = (id: number) => ada.some((m) => (m.notes || '').includes(tandaDraf(id)));
	return [...ada, ...drafs.filter((d) => !sudah(d.id)).map(drafKeBaris)];
}

/** Dari id draf yang diimpor: yang barisnya MASIH ADA di material_used yang disimpan (leader tidak menghapusnya). */
export function drafMasihAda(ids: readonly number[], materialUsed: Array<{ notes?: string | null }> | null | undefined): number[] {
	return ids.filter((id) => (materialUsed || []).some((m) => (m?.notes || '').includes(tandaDraf(id))));
}
