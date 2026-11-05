// src/lib/server/processPicContext.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn() }));
import { directusServerJson } from '$lib/server/directus';
import { loadPicIndex, clearPicIndexCache, resolveMyPosisi } from './processPicContext';
import { buildPosisiIndex } from '$lib/utils/processPicResolver';

const mock = directusServerJson as unknown as ReturnType<typeof vi.fn>;
const POSISI = [
	{ id: 30, nama_posisi: 'PROJECT LEADER' },
	{ id: 70, nama_posisi: 'MANAGER FINANCE' },
	{ id: 68, nama_posisi: 'ADMIN INVENTORY' }
];

beforeEach(() => {
	vi.clearAllMocks();
	clearPicIndexCache();
});

describe('loadPicIndex', () => {
	it('dua query terpisah (posisi + alias), indeks memakai alias; cache 5 menit', async () => {
		mock.mockImplementation(async (url: string) =>
			url.startsWith('/items/posisi') ? { data: POSISI } : { data: [{ setting_value: JSON.stringify({ 'Admin Gudang': 68 }) }] }
		);
		const a = await loadPicIndex({ now: 0 });
		expect(a.aliasMap.get('admin gudang')).toBe(68);
		expect(mock).toHaveBeenCalledTimes(2);
		const urls = mock.mock.calls.map((c) => c[0] as string);
		expect(urls[0]).toContain('/items/posisi?fields=id,nama_posisi');
		expect(urls[1]).toContain('filter[module][_eq]=process_guidance');
		expect(urls[1]).toContain('filter[setting_key][_eq]=pic_aliases');
		await loadPicIndex({ now: 200000 });
		expect(mock).toHaveBeenCalledTimes(2);
		await loadPicIndex({ now: 400000 });
		expect(mock).toHaveBeenCalledTimes(4);
	});

	it('baris alias belum ada → tanpa alias; gagal → melempar dan tidak di-cache', async () => {
		mock.mockImplementation(async (url: string) => (url.startsWith('/items/posisi') ? { data: POSISI } : { data: [] }));
		expect((await loadPicIndex()).aliasMap.size).toBe(0);
		clearPicIndexCache();
		mock.mockRejectedValueOnce(new Error('403'));
		await expect(loadPicIndex()).rejects.toThrow('403');
		mock.mockImplementation(async () => ({ data: [] }));
		await expect(loadPicIndex()).resolves.toBeTruthy();
	});
});

describe('resolveMyPosisi', () => {
	const idx = buildPosisiIndex(POSISI, { 'Admin Gudang': 68 });
	it('jabatan_id aktif dipakai', () => {
		expect(resolveMyPosisi({ jabatan_id: 70, posisi: '' }, idx)).toEqual({ id: 70, nama: 'MANAGER FINANCE', via: 'jabatan_id' });
	});
	it('jabatan_id kosong → teks posisi yang cocok pasti (nama sama / alias)', () => {
		expect(resolveMyPosisi({ jabatan_id: null, posisi: 'project leader' }, idx)).toEqual({ id: 30, nama: 'PROJECT LEADER', via: 'posisi_teks' });
		expect(resolveMyPosisi({ jabatan_id: null, posisi: 'Admin Gudang' }, idx)?.id).toBe(68);
	});
	it('jabatan_id tak ada di master → jatuh ke teks; tebakan tidak dipakai', () => {
		expect(resolveMyPosisi({ jabatan_id: 9999, posisi: 'MANAGER FINANCE' }, idx)?.id).toBe(70);
		expect(resolveMyPosisi({ jabatan_id: null, posisi: 'Project Leader Lapangan' }, idx)).toBeNull(); // hanya saran
		expect(resolveMyPosisi({ jabatan_id: null, posisi: '' }, idx)).toBeNull();
		expect(resolveMyPosisi({}, idx)).toBeNull();
	});
});
