import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn() }));
import { directusServerJson } from '$lib/server/directus';
import { anotasiSite, loadSiteGroupIds, loadSiteMap, siteUntukProyek, terapkanGeoSite } from './siteGeo';

const dx = vi.mocked(directusServerJson);
const geo = (id: number, lat: number | null = null, lng: number | null = null, r: number | null = null) => ({ id, geo_lat: lat, geo_lng: lng, geo_radius_m: r });
const SITE = { id: 1, nama: 'PT Prakarsalanggeng', geo_lat: -6.2, geo_lng: 106.4, radius_m: 250 };

beforeEach(() => { dx.mockReset(); });

describe('terapkanGeoSite', () => {
	it('titik proyek kosong → pakai titik site (radius proyek menang bila ada)', () => {
		expect(terapkanGeoSite(geo(1), SITE)).toMatchObject({ geo_lat: -6.2, geo_lng: 106.4, geo_radius_m: 250 });
		expect(terapkanGeoSite(geo(1, null, null, 80), SITE).geo_radius_m).toBe(80);
	});
	it('titik proyek sendiri menang; site tanpa titik / tanpa site → apa adanya', () => {
		const p = geo(1, -7, 107, 60);
		expect(terapkanGeoSite(p, SITE)).toBe(p);
		const kosong = geo(2);
		expect(terapkanGeoSite(kosong, { ...SITE, geo_lat: null })).toBe(kosong);
		expect(terapkanGeoSite(kosong, null)).toBe(kosong);
	});
});

describe('anotasiSite', () => {
	it('menandai site_id/nama/jumlah dan mewarisi titik; proyek tanpa grup site_jumlah 0', () => {
		const out = anotasiSite([geo(877), geo(904), geo(5)], new Map([[877, 1], [904, 1]]), new Map([[1, SITE]]));
		expect(out[0]).toMatchObject({ site_id: 1, site_nama: 'PT Prakarsalanggeng', site_jumlah: 2, geo_lat: -6.2 });
		expect(out[1]).toMatchObject({ site_id: 1, site_jumlah: 2 });
		expect(out[2]).toMatchObject({ site_id: null, site_nama: null, site_jumlah: 0, geo_lat: null });
	});
	it('grup yang site-nya tak terbaca diabaikan (bukan error)', () => {
		const out = anotasiSite([geo(877)], new Map([[877, 9]]), new Map());
		expect(out[0]).toMatchObject({ site_id: null, site_jumlah: 0 });
	});
});

describe('pemuat (fail-soft)', () => {
	it('loadSiteGroupIds: satu query, hanya yang punya grup; relasi objek diterima', async () => {
		dx.mockResolvedValue({ data: [{ id: 877, site_group_id: 1 }, { id: 904, site_group_id: { id: 1 } }] });
		const m = await loadSiteGroupIds([877, 904, 5]);
		expect([...m.entries()]).toEqual([[877, 1], [904, 1]]);
		expect(dx).toHaveBeenCalledTimes(1);
		expect(decodeURIComponent(String(dx.mock.calls[0][0]))).toContain('filter[site_group_id][_nnull]=true');
	});
	it('tanpa id → tanpa query', async () => {
		expect((await loadSiteGroupIds([])).size).toBe(0);
		expect((await loadSiteMap([])).size).toBe(0);
		expect(dx).not.toHaveBeenCalled();
	});
	it('gagal baca → peta kosong + console.warn (check-in tidak ikut gagal)', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		dx.mockImplementation(async () => { throw new Error("403"); });
		expect((await loadSiteGroupIds([1])).size).toBe(0);
		expect((await loadSiteMap([1])).size).toBe(0);
		expect(warn).toHaveBeenCalledTimes(2);
		warn.mockRestore();
	});
	it('siteUntukProyek: proyek tanpa grup → null (tanpa query site); dengan grup → site', async () => {
		dx.mockResolvedValueOnce({ data: [] });
		expect(await siteUntukProyek(5)).toBeNull();
		expect(dx).toHaveBeenCalledTimes(1);
		dx.mockReset();
		dx.mockResolvedValueOnce({ data: [{ id: 877, site_group_id: 1 }] }).mockResolvedValueOnce({ data: [{ id: 1, nama: 'PT X', geo_lat: '-6.2', geo_lng: '106.4', radius_m: 250 }] });
		expect(await siteUntukProyek(877)).toMatchObject({ id: 1, nama: 'PT X', geo_lat: -6.2, radius_m: 250 });
	});
});
