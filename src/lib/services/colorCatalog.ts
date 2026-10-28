// Fase 2 (Standarisasi Cat & Smart Swatch, 5 Okt 2026) — katalog warna standar (warna_fg)
// untuk ColorSwatchSelect.svelte. Query tunggal tanpa relasi bersarang (Aturan Directus
// #2), di-cache in-memory 5 menit karena 824 baris jarang berubah dan dipakai berkali-kali
// saat user mengetik di form packing list.
import directus from './directus';
import { readItems } from '@directus/sdk';

export interface ColorCatalogEntry {
	id: number;
	nama_warna: string;
	hex_color: string | null;
	category: string | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: ColorCatalogEntry[] | null = null;
let cacheAt = 0;
let inflight: Promise<ColorCatalogEntry[]> | null = null;

async function loadCatalog(): Promise<ColorCatalogEntry[]> {
	try {
		const result = (await directus.request(
			readItems('warna_fg', {
				fields: ['id', 'nama_warna', 'hex_color', 'category'],
				filter: { nama_warna: { _nnull: true } },
				sort: ['nama_warna'],
				limit: -1
			})
		)) as ColorCatalogEntry[];
		return result || [];
	} catch (e) {
		console.warn('[colorCatalog] gagal memuat katalog warna_fg (fallback: input bebas):', e);
		return [];
	}
}

/** Ambil seluruh katalog warna standar, cached 5 menit. */
export async function getColorCatalog(): Promise<ColorCatalogEntry[]> {
	const now = Date.now();
	if (cache && now - cacheAt < CACHE_TTL_MS) return cache;
	if (inflight) return inflight;
	inflight = loadCatalog().then((rows) => {
		cache = rows;
		cacheAt = Date.now();
		inflight = null;
		return rows;
	});
	return inflight;
}

/** Cari di katalog (client-side, dari cache) — hemat API karena tak nembak Directus per keystroke. */
export async function searchColorCatalog(query: string, limit = 15): Promise<ColorCatalogEntry[]> {
	const catalog = await getColorCatalog();
	const q = query.trim().toLowerCase();
	if (!q) return catalog.slice(0, limit);
	return catalog.filter((c) => c.nama_warna.toLowerCase().includes(q)).slice(0, limit);
}

/** Ambil hex code untuk nama warna tertentu dari katalog warna_fg. */
export async function getColorHex(colorName: string): Promise<string | null> {
	if (!colorName) return null;
	const norm = colorName.trim().toLowerCase();
	if (!norm) return null;
	const catalog = await getColorCatalog();
	const match = catalog.find((c) => c.nama_warna.toLowerCase() === norm);
	return match?.hex_color || null;
}

