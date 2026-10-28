// src/lib/services/workshopStokApi.ts
// R4 (Cek Stok Real-time Ciketing di Field) — docs/(analyst) analisis-inventory-
// ciketing_...v2.md §7. Read-only: PL/mekanik lihat stok ciketing_item dari HP,
// tanpa lewat dashboard admin. Pola auth/service sama workshopOpsApi.ts — proxy
// Directus terautentikasi lewat Firebase ID token, bukan token Directus.

import directus, { handleDirectusError } from './directus';
import { readItems, aggregate } from '@directus/sdk';
import { opsProfile, type OpsWorkshopKey } from './workshopOpsProfile';

export interface WorkshopStokRow {
	id: number;
	kode: string | null;
	namaBarang: string;
	kategori: string | null;
	satuanDefault: string | null;
	stokTersedia: number;
	stokMin: number;
	statusKritis: boolean;
}

/** Alias lama. */
export type CiketingStokRow = WorkshopStokRow;

/** Σ IN − Σ OUT per item dari hasil agregat ledger ([{ item, tipe, sum: { qty } }]). */
export function ledgerBalances(rows: Array<{ item: any; tipe: string; sum?: { qty?: any } }>): Map<number, number> {
	const out = new Map<number, number>();
	for (const r of rows || []) {
		const id = Number(r?.item && typeof r.item === 'object' ? r.item.id : r?.item);
		if (!id) continue;
		const qty = Number(r?.sum?.qty) || 0;
		out.set(id, (out.get(id) || 0) + (r.tipe === 'IN' ? qty : r.tipe === 'OUT' ? -qty : 0));
	}
	return out;
}

/**
 * Ambil seluruh item aktif workshop dengan stok terkini. Read-only — TIDAK ada
 * write di modul ini (sesuai R4: "PL/mekanik cek stok dari HP", bukan transaksi).
 * Ciketing: kolom ciketing_item.stok_tersedia. Balaraja: tidak ada kolom saldo → Σ ledger IN − OUT.
 */
export async function fetchWorkshopStok(ws: OpsWorkshopKey = 'ciketing'): Promise<WorkshopStokRow[]> {
	const P = opsProfile(ws);
	try {
		const itemFields = ['id', 'kode', 'nama_barang', 'kategori', 'satuan_default', 'stok_min', ...(P.stockColumn ? ['stok_tersedia'] : [])];
		const [rows, agg] = await Promise.all([
			directus.request(
				readItems(P.itemCollection as any, {
					filter: { aktif: { _eq: true } } as any,
					fields: itemFields as any,
					sort: ['nama_barang'] as any,
					limit: -1
				})
			),
			P.stockColumn
				? Promise.resolve([] as any[])
				: (directus.request(
						aggregate(P.ledgerCollection as any, { aggregate: { sum: ['qty'] }, groupBy: ['item', 'tipe'], query: { limit: -1 } } as any)
					) as Promise<any[]>)
		]);
		const bal = P.stockColumn ? null : ledgerBalances(agg);
		return (rows as any[]).map((r) => {
			const stokTersedia = bal ? bal.get(Number(r.id)) || 0 : Number(r.stok_tersedia) || 0;
			const stokMin = Number(r.stok_min) || 0;
			return {
				id: r.id,
				kode: r.kode || null,
				namaBarang: r.nama_barang || '-',
				kategori: r.kategori || null,
				satuanDefault: r.satuan_default || null,
				stokTersedia,
				stokMin,
				statusKritis: stokMin > 0 && stokTersedia < stokMin
			};
		});
	} catch (e) {
		handleDirectusError(e);
		return [];
	}
}

/** Alias lama (pemanggil Ciketing). */
export const fetchCiketingStok = () => fetchWorkshopStok('ciketing');
