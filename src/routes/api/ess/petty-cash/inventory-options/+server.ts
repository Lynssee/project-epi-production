// src/routes/api/ess/petty-cash/inventory-options/+server.ts
// Pencarian barang inventori (identitas_barang) dan daftar gudang aktif untuk opsi Stock-IN Kas Kecil.
// Guard: sesi ESS karyawan aktif.
// Optimasi: in-memory cache untuk daftar gudang (5 menit) & hemat Directus call.

import { json, type RequestHandler } from '@sveltejs/kit';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

let cachedWarehouses: { data: any[]; expiry: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);

	const q = (event.url.searchParams.get('q') || '').trim();
	const fetchWarehouses = event.url.searchParams.get('warehouses') === '1' || event.url.searchParams.get('warehouses') === 'true';

	const now = Date.now();
	let warehousesPromise: Promise<any[]> = Promise.resolve([]);

	if (fetchWarehouses) {
		if (cachedWarehouses && cachedWarehouses.expiry > now) {
			warehousesPromise = Promise.resolve(cachedWarehouses.data);
		} else {
			warehousesPromise = directusServerJson<{ data: any[] }>(
				'/items/gudang?fields=id,kode_gudang,nama_gudang,jenis&filter[is_active][_eq]=true&sort=nama_gudang&limit=-1'
			)
				.then((res) => {
					const list = res?.data || [];
					cachedWarehouses = { data: list, expiry: now + CACHE_TTL_MS };
					return list;
				})
				.catch((err) => {
					console.error('[ess/petty-cash/inventory-options] gagal memuat gudang:', err?.message || err);
					return cachedWarehouses?.data || [];
				});
		}
	}

	let itemsPromise: Promise<any[]> = Promise.resolve([]);
	if (q.length >= 2) {
		const encoded = encodeURIComponent(q);
		itemsPromise = directusServerJson<{ data: any[] }>(
			`/items/identitas_barang?fields=id,kode_item,nama_barang_lengkap,satuan` +
				`&filter[_or][0][nama_barang_lengkap][_icontains]=${encoded}` +
				`&filter[_or][1][kode_item][_icontains]=${encoded}` +
				`&sort=nama_barang_lengkap&limit=25`
		)
			.then((res) => res?.data || [])
			.catch((err) => {
				console.error('[ess/petty-cash/inventory-options] gagal mencari barang:', err?.message || err);
				return [];
			});
	}

	const [warehouses, items] = await Promise.all([warehousesPromise, itemsPromise]);

	return json({ items, warehouses });
};
