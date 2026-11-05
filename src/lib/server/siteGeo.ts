// src/lib/server/siteGeo.ts
// GPM-C11 — grup site: satu lokasi fisik dengan banyak PO/proyek. Koleksi `project_sites` (nama, geo_lat, geo_lng, radius_m) dan
// `projects.site_group_id` dibuat lewat erp-epi/scratch/2026-10-buat-project-sites.mjs. Titik geofence boleh dipasang di tingkat site:
// proyek yang titiknya sendiri kosong memakai titik site-nya (titik milik proyek selalu menang).
// Semua pembacaan di sini fail-soft (console.warn, bukan diam): check-in tidak boleh gagal hanya karena data site tak terbaca.

import { directusServerJson } from '$lib/server/directus';

export interface SiteInfo {
	id: number;
	nama: string;
	geo_lat: number | null;
	geo_lng: number | null;
	radius_m: number | null;
}

const idOf = (v: any) => (v && typeof v === 'object' ? v.id : v);
const num = (v: any): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Site berdasarkan id (satu query). Kegagalan baca → peta kosong + peringatan. */
export async function loadSiteMap(siteIds: Array<number | string>): Promise<Map<number, SiteInfo>> {
	const ids = [...new Set(siteIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
	if (!ids.length) return new Map();
	try {
		const q = new URLSearchParams({ 'filter[id][_in]': ids.join(','), fields: 'id,nama,geo_lat,geo_lng,radius_m', limit: '-1' });
		const res = await directusServerJson<{ data: any[] }>(`/items/project_sites?${q.toString()}`);
		return new Map(
			(res?.data || []).map((s) => [Number(s.id), { id: Number(s.id), nama: String(s.nama || `Site #${s.id}`), geo_lat: num(s.geo_lat), geo_lng: num(s.geo_lng), radius_m: num(s.radius_m) }])
		);
	} catch (e) {
		console.warn('[siteGeo] gagal membaca project_sites (grup site diabaikan):', (e as any)?.message || e);
		return new Map();
	}
}

/** Peta projectId → site_group_id untuk sekumpulan proyek (satu query; hanya proyek yang punya grup). Fail-soft. */
export async function loadSiteGroupIds(projectIds: Array<number | string>): Promise<Map<number, number>> {
	const ids = [...new Set(projectIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
	if (!ids.length) return new Map();
	try {
		const q = new URLSearchParams({ 'filter[id][_in]': ids.join(','), 'filter[site_group_id][_nnull]': 'true', fields: 'id,site_group_id', limit: '-1' });
		const res = await directusServerJson<{ data: any[] }>(`/items/projects?${q.toString()}`);
		const out = new Map<number, number>();
		for (const p of res?.data || []) {
			const sid = Number(idOf(p.site_group_id));
			if (Number.isFinite(sid) && sid > 0) out.set(Number(p.id), sid);
		}
		return out;
	} catch (e) {
		console.warn('[siteGeo] gagal membaca projects.site_group_id (grup site diabaikan):', (e as any)?.message || e);
		return new Map();
	}
}

/** Titik proyek menang; bila kosong dan site punya titik, pakai titik site. Murni. */
export function terapkanGeoSite<T extends { geo_lat: number | null; geo_lng: number | null; geo_radius_m: number | null }>(p: T, site: SiteInfo | null | undefined): T {
	if (!site || (p.geo_lat != null && p.geo_lng != null) || site.geo_lat == null || site.geo_lng == null) return p;
	return { ...p, geo_lat: site.geo_lat, geo_lng: site.geo_lng, geo_radius_m: p.geo_radius_m ?? site.radius_m };
}

/** Site milik satu proyek (null bila tidak punya grup atau gagal baca). */
export async function siteUntukProyek(projectId: number): Promise<SiteInfo | null> {
	const grup = await loadSiteGroupIds([projectId]);
	const sid = grup.get(Number(projectId));
	if (!sid) return null;
	return (await loadSiteMap([sid])).get(sid) || null;
}

export interface InfoSiteOpsi {
	site_id: number | null;
	site_nama: string | null;
	/** jumlah proyek dalam daftar yang berada di site yang sama (termasuk dirinya) */
	site_jumlah: number;
}

/** Tambahkan info site ke daftar opsi proyek + warisi titik site bila titik proyek kosong. Murni. */
export function anotasiSite<T extends { id: number; geo_lat: number | null; geo_lng: number | null; geo_radius_m: number | null }>(
	opsi: T[],
	grupPerProyek: Map<number, number>,
	sites: Map<number, SiteInfo>
): Array<T & InfoSiteOpsi> {
	const hitung = new Map<number, number>();
	for (const o of opsi) {
		const sid = grupPerProyek.get(o.id);
		if (sid && sites.has(sid)) hitung.set(sid, (hitung.get(sid) || 0) + 1);
	}
	return opsi.map((o) => {
		const sid = grupPerProyek.get(o.id);
		const site = sid ? sites.get(sid) : undefined;
		const dasar = terapkanGeoSite(o, site);
		return { ...dasar, site_id: site ? site.id : null, site_nama: site ? site.nama : null, site_jumlah: site ? hitung.get(site.id) || 1 : 0 };
	});
}
