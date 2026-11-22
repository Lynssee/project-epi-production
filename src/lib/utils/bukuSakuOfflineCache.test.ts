import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, any>();
const cacheDocumentFile = vi.fn(async (id: string, blob: Blob, fileName: string) => { store.set(id, { fileId: id, blob, fileName, cachedAt: '2026-11-17T01:00:00Z' }); });
vi.mock('$lib/utils/offlineDocumentCache', () => ({
	cacheDocumentFile: (...a: [string, Blob, string]) => cacheDocumentFile(...a),
	getCachedDocumentFile: async (id: string) => store.get(id) ?? null,
	removeCachedDocumentFile: async (id: string) => { store.delete(id); }
}));
const { simpanSalinanBukuSaku, bacaSalinanBukuSaku, hapusSalinanBukuSaku } = await import('./bukuSakuOfflineCache');

beforeEach(() => { store.clear(); vi.clearAllMocks(); });

describe('bukuSakuOfflineCache', () => {
	it('simpan → baca: kunci per karyawan + jabatan (orang/jabatan lain tidak melihat salinan ini)', async () => {
		const blob = new Blob(['%PDF'], { type: 'application/pdf' });
		expect(await simpanSalinanBukuSaku(12, 5, blob, 'MEKANIK')).toBe(true);
		expect(cacheDocumentFile.mock.calls[0][0]).toBe('buku-saku-jabatan:12:5');
		expect(cacheDocumentFile.mock.calls[0][2]).toBe('Buku Saku Jabatan - MEKANIK.pdf');
		expect((await bacaSalinanBukuSaku(12, 5))?.cachedAt).toBe('2026-11-17T01:00:00Z');
		expect(await bacaSalinanBukuSaku(13, 5)).toBeNull();
		expect(await bacaSalinanBukuSaku(12, 6)).toBeNull();
		await hapusSalinanBukuSaku(12, 5);
		expect(await bacaSalinanBukuSaku(12, 5)).toBeNull();
	});
	it('penyimpanan gagal (IndexedDB tak tersedia / penuh) → false tanpa melempar', async () => {
		cacheDocumentFile.mockRejectedValueOnce(new Error('QuotaExceeded'));
		const w = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(await simpanSalinanBukuSaku(1, 1, new Blob(['x']))).toBe(false);
		w.mockRestore();
	});
});
