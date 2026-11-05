// src/lib/server/expiryLapangan.ts
// SERVER-ONLY. Sumber data petunjuk kadaluarsa untuk layar lapangan (Rencana Expired Date v2, Fase 5).
// READ-ONLY; hemat API: 1 query setelan (di-cache 5 menit) + 1 query batch aktif per 100 barang.
import { directusServerJson } from './directus';
import { getInventorySettingServer } from './inventorySettings';
import { ringkasExpiryPerItem, type BatchAktifRingkas, type ExpiryHintItem } from '$lib/utils/batchKelayakan';

const AGING_KEY = 'inventory.shelf_life.aging_hari_default';
const AGING_DEFAULT = 30;
const TTL_MS = 5 * 60 * 1000;
let agingCache: { at: number; value: number } | null = null;

/** Ambang "prioritas FEFO" (hari) dari setelan ERP — default 30 bila belum diatur / tak terbaca. */
export async function getAgingHari(): Promise<number> {
	if (agingCache && Date.now() - agingCache.at < TTL_MS) return agingCache.value;
	const raw = await getInventorySettingServer<number>(AGING_KEY, AGING_DEFAULT);
	const n = Math.floor(Number(raw));
	const value = Number.isFinite(n) && n > 0 ? n : AGING_DEFAULT;
	agingCache = { at: Date.now(), value };
	return value;
}

export function _resetAgingCacheForTest() {
	agingCache = null;
}

/** Hanya angka bulat positif unik, maks. `max` id (batas parameter URL & beban query). */
export function parseItemIds(raw: string | null | undefined, max = 200): number[] {
	const ids = String(raw ?? '')
		.split(',')
		.map((s) => Number(s.trim()))
		.filter((n) => Number.isInteger(n) && n > 0);
	return [...new Set(ids)].slice(0, max);
}

export async function fetchBatchAktif(itemIds: number[]): Promise<BatchAktifRingkas[]> {
	const out: BatchAktifRingkas[] = [];
	for (let i = 0; i < itemIds.length; i += 100) {
		const part = itemIds.slice(i, i + 100);
		const res = await directusServerJson<{ data: BatchAktifRingkas[] }>(
			`/items/item_batch?filter[item_id][_in]=${part.join(',')}&filter[status][_eq]=active&filter[qty_tersisa][_gt]=0` +
				`&fields=id,item_id,lot_number,batch_no_fg,tanggal_kadaluarsa,qty_tersisa,satuan&limit=-1`
		);
		out.push(...(res?.data || []));
	}
	return out;
}

export async function buildExpiryHints(itemIds: number[], now: Date = new Date()): Promise<{ agingHari: number; items: Record<number, ExpiryHintItem> }> {
	if (!itemIds.length) return { agingHari: await getAgingHari(), items: {} };
	const [agingHari, batches] = await Promise.all([getAgingHari(), fetchBatchAktif(itemIds)]);
	return { agingHari, items: ringkasExpiryPerItem(batches, agingHari, now) };
}
