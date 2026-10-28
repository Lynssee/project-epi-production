// src/lib/server/gaRuanganMeta.ts
// Meta ruangan (ga_areas -> ga_zones -> ga_locations) untuk fitur "Barang per Ruangan".
// Relasi DIPISAH per query (Aturan Anti-Kesalahan #2) — tanpa nested expansion.
// Meta di-cache 5 menit (29 ruangan jarang berubah). Jumlah barang TIDAK di-cache
// (berubah tiap sensus / konfirmasi selisih) tapi tetap 1 query agregat ringan.

import { directusServerJson } from './directus';

export interface RoomMeta {
	area_id: number;
	area_name: string;
	zone_id: number | null;
	zone_name: string | null;
	location_id: number | null;
	location_name: string | null;
	/** karyawan_id yang ditugaskan di ruangan (dari ga_areas.assigned_staff_ids). */
	assigned_staff_ids: string[];
	template_id: number | null;
}

const CACHE_TTL_MS = 300_000;
const _cache = new Map<number, { at: number; value: RoomMeta | null }>();

/** Meta 1 ruangan (cache 5 menit). null bila area tidak ada. */
export async function getRoomMeta(areaId: number): Promise<RoomMeta | null> {
	const hit = _cache.get(areaId);
	if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

	let value: RoomMeta | null = null;
	try {
		const areaRes = await directusServerJson<{ data: any }>(
			`/items/ga_areas/${areaId}?fields=id,area_name,zone_id,template_id,assigned_staff_ids`
		);
		const area = areaRes?.data;
		if (area) {
			value = {
				area_id: area.id,
				area_name: area.area_name ?? `Ruangan #${area.id}`,
				zone_id: area.zone_id ?? null,
				zone_name: null,
				location_id: null,
				location_name: null,
				assigned_staff_ids: Array.isArray(area.assigned_staff_ids) ? area.assigned_staff_ids.map(String) : [],
				template_id: area.template_id ?? null
			};
			if (value.zone_id != null) {
				const zoneRes = await directusServerJson<{ data: any }>(
					`/items/ga_zones/${value.zone_id}?fields=id,zone_name,location_id`
				).catch((err) => {
					console.error(`[gaRuanganMeta] gagal baca ga_zones/${value?.zone_id}:`, err);
					return null;
				});
				const zone = zoneRes?.data;
				if (zone) {
					value.zone_name = zone.zone_name ?? null;
					value.location_id = zone.location_id ?? null;
					if (value.location_id != null) {
						const locRes = await directusServerJson<{ data: any }>(
							`/items/ga_locations/${value.location_id}?fields=id,location_name`
						).catch((err) => {
							console.error(`[gaRuanganMeta] gagal baca ga_locations/${value?.location_id}:`, err);
							return null;
						});
						value.location_name = locRes?.data?.location_name ?? null;
					}
				}
			}
		}
	} catch (err) {
		// Aturan #1: 403/500 Directus = kemungkinan salah field/relasi, bukan izin. Catat jelas.
		console.error(`[gaRuanganMeta] gagal baca ga_areas/${areaId}:`, err);
		return null; // jangan cache kegagalan
	}

	_cache.set(areaId, { at: Date.now(), value });
	return value;
}

/** Jumlah barang tercatat di ruangan (exclude disposal). 0 bila belum ada / gagal. */
export async function getRoomItemCount(areaId: number): Promise<number> {
	try {
		const res = await directusServerJson<{ data: Array<{ count: { id: number } | number }> }>(
			`/items/ga_asset?filter[area_id][_eq]=${areaId}&filter[status][_neq]=disposal&aggregate[count]=id`
		);
		const row = res?.data?.[0]?.count as any;
		const n = typeof row === 'object' && row !== null ? Number(row.id) : Number(row);
		return Number.isFinite(n) ? n : 0;
	} catch (err) {
		console.error(`[gaRuanganMeta] gagal hitung barang ruangan ${areaId}:`, err);
		return 0;
	}
}

/** Kosongkan cache (test / setelah edit master ruangan). */
export function clearRoomMetaCache(): void {
	_cache.clear();
}
