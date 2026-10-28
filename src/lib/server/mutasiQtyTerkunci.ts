// src/lib/server/mutasiQtyTerkunci.ts
// RSM-13 §4.2 — qty yang sedang "akan dimutasi" (mutasi diajukan/disetujui, BELUM berangkat) tidak boleh diretur atau
// dipindah lagi. Setelah `kirim`, ledger TRANSFER-OUT sudah mengurangi saldo, jadi tidak dikunci lagi (hindari hitung ganda).
// Daftar status ini HARUS sama dengan STATUS_AKTIF_KUNCI_QTY di erp-epi/src/lib/shared/mutasiBarang.js.
//
// Skema mutasi belum tentu sudah diterapkan: bila koleksi tak terbaca, kunci dianggap kosong tetapi DICATAT jelas (Aturan #1).

import { directusServerJson } from './directus';

export const STATUS_KUNCI_QTY = ['diajukan', 'disetujui_tujuan'] as const;

let terakhirLog = 0;
function catatSekali(pesan: string, e: unknown) {
	const now = Date.now();
	if (now - terakhirLog < 60_000) return;
	terakhirLog = now;
	console.error(pesan, e instanceof Error ? e.message : e);
}

const unwrap = (v: any) => (v && typeof v === 'object' ? v.id : v);

/** item_id → qty terkunci pada proyek asal. Dua query terpisah (header, lalu baris) — Aturan #2. */
export async function getQtyTerkunciMutasi(projectId: number): Promise<Map<number, number>> {
	const out = new Map<number, number>();
	try {
		const heads =
			(
				await directusServerJson<{ data: Array<{ id: number }> }>(
					`/items/mutasi_barang?filter[asal_tipe][_eq]=project&filter[asal_id][_eq]=${Number(projectId)}` +
						`&filter[status][_in]=${STATUS_KUNCI_QTY.join(',')}&fields=id&limit=-1`
				)
			)?.data || [];
		if (!heads.length) return out;
		const items =
			(
				await directusServerJson<{ data: Array<{ mutasi_id: any; item_id: number; qty: number }> }>(
					`/items/mutasi_barang_items?filter[mutasi_id][_in]=${heads.map((h) => h.id).join(',')}&fields=mutasi_id,item_id,qty&limit=-1`
				)
			)?.data || [];
		for (const it of items) {
			if (unwrap(it.mutasi_id) == null) continue;
			out.set(Number(it.item_id), (out.get(Number(it.item_id)) || 0) + (Number(it.qty) || 0));
		}
	} catch (e) {
		catatSekali('[mutasiQtyTerkunci] mutasi_barang tak terbaca (skema belum diterapkan?) — qty terkunci dianggap 0:', e);
		return new Map();
	}
	return out;
}

/** Murni: saldo yang boleh dipakai = saldo − terkunci (tidak negatif). */
export const saldoTersedia = (onHand: number, terkunci: number): number => Math.max(0, (Number(onHand) || 0) - (Number(terkunci) || 0));
