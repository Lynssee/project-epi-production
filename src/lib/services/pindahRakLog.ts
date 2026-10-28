// src/lib/services/pindahRakLog.ts
// Rekap audit pergerakan "pindah lokasi rak" yang dilakukan tim gudang lewat terminal Kiosk.
// Sumber: baris stock_transactions kategori TRANSFER-RAK-OUT (satu baris kanonik per perpindahan;
// pasangannya TRANSFER-RAK-IN di rak tujuan). Read-only, untuk supervisor.
// Fase 2, rencana "Penajaman Kiosk Inventory — Cek Lokasi Rak & Qty Barang" (8 Sep 2026).

import { secureDirectusFetch } from './secureDirectus';

export interface PindahRakLogRow {
	id: number;
	tanggal: string;
	operator_nama: string;
	operator_id: number | null;
	item_id: number;
	item_nama: string;
	qty: number;
	satuan: string | null;
	rak_asal_id: number;
	rak_asal_nama: string;
	rak_tujuan_id: number | null;
	rak_tujuan_nama: string | null;
	reference_no: string | null;
	flag_selisih: boolean;
	catatan: string | null;
}

async function dget<T = any>(path: string): Promise<T[]> {
	const res = await secureDirectusFetch(path);
	if (!res.ok) return [];
	return (await res.json()).data || [];
}

/** "kiosk:pindah-rak:Budi (#42)" -> { nama: 'Budi', id: 42 } */
function parseOperator(source: string | null): { nama: string; id: number | null } {
	if (!source) return { nama: '-', id: null };
	const m = source.match(/^kiosk:pindah-rak:(.*?)(?:\s*\(#(\d+)\))?$/);
	if (!m) return { nama: source, id: null };
	return { nama: (m[1] || '').trim() || '-', id: m[2] ? Number(m[2]) : null };
}

export async function getPindahRakLog(opts: { days?: number; limit?: number } = {}): Promise<PindahRakLogRow[]> {
	const days = opts.days ?? 14;
	const since = new Date(Date.now() - days * 86400000).toISOString();
	const rows = await dget<any>(
		`/items/stock_transactions?filter[category_transaction][_eq]=TRANSFER-RAK-OUT` +
			`&filter[transaction_date][_gte]=${since}` +
			`&fields=id,transaction_date,item_id,quantity,gudang_id,destination_id,destination_name,reference_no,source,notes` +
			`&sort=-transaction_date&limit=${opts.limit ?? 200}`
	);
	if (!rows.length) return [];

	const itemIds = [...new Set(rows.map((r) => r.item_id).filter(Boolean))];
	const gudangIds = [...new Set(rows.map((r) => r.gudang_id).filter(Boolean))];
	const [items, gudangs] = await Promise.all([
		itemIds.length
			? dget<any>(`/items/identitas_barang?filter[id][_in]=${itemIds.join(',')}&fields=id,nama_barang_lengkap,satuan&limit=-1`)
			: Promise.resolve([]),
		gudangIds.length
			? dget<any>(`/items/gudang?filter[id][_in]=${gudangIds.join(',')}&fields=id,nama_gudang&limit=-1`)
			: Promise.resolve([])
	]);
	const itemMap = new Map(items.map((i: any) => [i.id, i]));
	const gudangMap = new Map(gudangs.map((g: any) => [g.id, g.nama_gudang]));

	return rows.map((r) => {
		const op = parseOperator(r.source);
		const it = itemMap.get(r.item_id) || {};
		return {
			id: r.id,
			tanggal: r.transaction_date,
			operator_nama: op.nama,
			operator_id: op.id,
			item_id: r.item_id,
			item_nama: it.nama_barang_lengkap || `Barang #${r.item_id}`,
			qty: Number(r.quantity) || 0,
			satuan: it.satuan || null,
			rak_asal_id: r.gudang_id,
			rak_asal_nama: gudangMap.get(r.gudang_id) || `#${r.gudang_id}`,
			rak_tujuan_id: r.destination_id ?? null,
			rak_tujuan_nama: r.destination_name || (r.destination_id ? `#${r.destination_id}` : null),
			reference_no: r.reference_no || null,
			flag_selisih: typeof r.notes === 'string' && r.notes.includes('[SELISIH'),
			catatan: r.notes || null
		};
	});
}
