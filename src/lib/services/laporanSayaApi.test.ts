import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ token: vi.fn(async () => 'tok'), enqueue: vi.fn(async () => {}) }));
vi.mock('$lib/services/secureDirectus', () => ({ getIdToken: h.token }));
vi.mock('$lib/utils/offlineReportEventQueue', () => ({
	enqueueReportEvent: h.enqueue,
	registerReportEventAutoFlush: vi.fn(() => () => {})
}));

import { isOpenableInLapangan, filterLaporanSaya, fetchLaporanSaya, logReportEvent } from './laporanSayaApi';

function memoryStorage() {
	const m = new Map<string, string>();
	return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe('laporanSayaApi', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		h.token.mockImplementation(async () => 'tok');
		h.enqueue.mockClear();
		vi.stubGlobal('localStorage', memoryStorage());
		vi.stubGlobal('window', {});
	});

	it('isOpenableInLapangan: tolak rute admin, {id}, dan kosong', () => {
		expect(isOpenableInLapangan({ route_template: '/laporan' })).toBe(true);
		expect(isOpenableInLapangan({ route_template: '/print/finance-report' })).toBe(false);
		expect(isOpenableInLapangan({ route_template: '/reports/arsip' })).toBe(false);
		expect(isOpenableInLapangan({ route_template: '/api/x' })).toBe(false);
		expect(isOpenableInLapangan({ route_template: '/lacak/{id}' })).toBe(false);
		expect(isOpenableInLapangan({ route_template: null })).toBe(false);
	});

	it('filterLaporanSaya: pencarian & favorit', () => {
		const items = [{ key: 'a', title: 'Laporan Harian' }, { key: 'b', title: 'Surat Jalan', hint: 'lacak' }];
		expect(filterLaporanSaya(items, 'harian', false, new Set()).map((r) => r.key)).toEqual(['a']);
		expect(filterLaporanSaya(items, 'LACAK', false, new Set()).map((r) => r.key)).toEqual(['b']);
		expect(filterLaporanSaya(items, '', true, new Set(['b'])).map((r) => r.key)).toEqual(['b']);
	});

	it('fetchLaporanSaya: online menyimpan salinan; offline memakai salinan + penanda', async () => {
		const payload = { source: 'directus', items: [{ key: 'a', title: 'A' }], counts: { a: 2 } };
		vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload })));
		const online = await fetchLaporanSaya();
		expect(online.offline).toBeUndefined();

		vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
		const off = await fetchLaporanSaya();
		expect(off.offline).toBe(true);
		expect(off.items[0].key).toBe('a');
		expect(off.cachedAt).toBeTruthy();
	});

	it('fetchLaporanSaya: offline tanpa salinan ⇒ melempar', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
		await expect(fetchLaporanSaya()).rejects.toThrow();
	});

	it('logReportEvent: gagal jaringan ⇒ diantre; respons server (202) ⇒ tidak diantre', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
		logReportEvent({ catalog_key: 'surat-jalan', action: 'view' });
		await vi.waitFor(() => expect(h.enqueue).toHaveBeenCalledTimes(1));
		expect(h.enqueue).toHaveBeenCalledWith({ catalog_key: 'surat-jalan', action: 'view' });

		h.enqueue.mockClear();
		const f = vi.fn(async () => ({ ok: false, status: 202 }));
		vi.stubGlobal('fetch', f);
		logReportEvent({ catalog_key: 'surat-jalan' });
		await vi.waitFor(() => expect(f).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 10));
		expect(h.enqueue).not.toHaveBeenCalled();
	});
});
