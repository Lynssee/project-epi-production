import { describe, it, expect, vi } from 'vitest';
import { createPocketGuide, prunePocket, planPrefetch, POCKET_STORAGE_KEY, type PocketStorage } from './inventoryPocketGuide';

function memStorage(limitChars = Infinity): PocketStorage & { raw: () => string | null } {
	let v: string | null = null;
	return {
		getItem: () => v,
		setItem: (_k, val) => {
			if (val.length > limitChars) throw new Error('QuotaExceededError');
			v = val;
		},
		removeItem: () => {
			v = null;
		},
		raw: () => v
	};
}

const DAY = 86400000;
const template = { id: 5, nama: 'Cat', spec_fields: [], sections_aktif: ['panduan_pakai'], context_map: { usage: ['panduan_pakai'] }, min_score_verified: 70, catatan: 'jangan simpan', date_updated: 'x' };
const card = (itemId: number, extra: Record<string, any> = {}) => ({
	itemId,
	source: 'item' as const,
	groupId: null,
	href: `/x/${itemId}`,
	template,
	profile: { id: itemId, status: 'verified', apd: ['Masker'], panduan_pakai: { cara_pasang: 'Aduk' }, foto_ids: ['f1'], verified_by: 'rahasia', ...extra }
});

describe('pocket guide', () => {
	it('menyimpan ringkas: tanpa foto/jejak verifikasi, template sekali per id', () => {
		const s = memStorage();
		const p = createPocketGuide(s, { now: () => 1000 });
		expect(p.saveMany([card(1), card(2)])).toBe(2);
		const raw = s.raw() as string;
		expect(raw).not.toContain('foto_ids');
		expect(raw).not.toContain('rahasia');
		expect(raw).not.toContain('jangan simpan');
		expect(raw.match(/"nama":"Cat"/g)).toHaveLength(1);
	});

	it('get mengembalikan kartu bertanda offline lengkap dengan template', () => {
		const p = createPocketGuide(memStorage(), { now: () => 5000 });
		p.saveMany([card(7)]);
		const c = p.get(7)!;
		expect(c.offline).toEqual({ at: 5000 });
		expect(c.profile?.apd).toEqual(['Masker']);
		expect(c.template?.id).toBe(5);
		expect(p.get(999)).toBeNull();
	});

	it('kartu tanpa profil & salinan offline tidak disimpan', () => {
		const p = createPocketGuide(memStorage());
		expect(p.saveMany([{ ...card(1), profile: null }, { ...card(2), offline: { at: 1 } }, null, undefined])).toBe(0);
		expect(p.stats().items).toBe(0);
	});

	it('melewati batas umur: get null, pruning membuang', () => {
		let t = 0;
		const s = memStorage();
		const p = createPocketGuide(s, { maxAgeDays: 10, now: () => t });
		p.saveMany([card(1)]);
		t = 11 * DAY;
		expect(p.get(1)).toBeNull();
		t = 9 * DAY;
		expect(p.get(1)).not.toBeNull();
		t = 11 * DAY;
		p.saveMany([card(2)]);
		expect(p.stats().items).toBe(1);
	});

	it('LRU: melebihi maxItems membuang yang terlama', () => {
		let t = 0;
		const p = createPocketGuide(memStorage(), { maxItems: 2, now: () => ++t });
		p.saveMany([card(1)]);
		p.saveMany([card(2)]);
		p.saveMany([card(3)]);
		expect(p.get(1)).toBeNull();
		expect(p.get(2)).not.toBeNull();
		expect(p.get(3)).not.toBeNull();
	});

	it('kuota penuh: menyisakan separuh terbaru dan tidak melempar', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		let t = 0;
		const big = (id: number) => card(id, { bahaya: 'x'.repeat(300) });
		const s = memStorage(1400);
		const p = createPocketGuide(s, { maxItems: 4, now: () => ++t });
		p.saveMany([big(1), big(2), big(3), big(4)].slice(0, 2));
		expect(() => p.saveMany([big(3), big(4)])).not.toThrow();
		expect(p.stats().items).toBeGreaterThan(0);
		warn.mockRestore();
	});

	it('tanpa storage (SSR) atau data rusak aman', () => {
		const none = createPocketGuide(null);
		expect(none.saveMany([card(1)])).toBe(0);
		expect(none.get(1)).toBeNull();
		const s = memStorage();
		s.setItem(POCKET_STORAGE_KEY, '{bukan json');
		expect(createPocketGuide(s).get(1)).toBeNull();
		expect(createPocketGuide(s).saveMany([card(1)])).toBe(1);
	});

	it('clear menghapus semua; prunePocket membuang template yatim', () => {
		const s = memStorage();
		const p = createPocketGuide(s);
		p.saveMany([card(1)]);
		p.clear();
		expect(p.stats().items).toBe(0);
		const pruned = prunePocket({ v: 1, items: {}, templates: { '5': { id: 5 } } }, 0, 5, 30);
		expect(pruned.templates).toEqual({});
	});
});

describe('planPrefetch', () => {
	const none = () => null;
	it('membuang duplikat/tidak valid dan menjaga urutan prioritas', () => {
		const r = planPrefetch([5, '5', 3, null, undefined, 0, -1, 'x', 9], 10, none);
		expect(r).toEqual({ toFetch: [5, 3, 9], trimmed: 0, skippedFresh: 0 });
	});
	it('memangkas ke maxItems (yang prioritas rendah dibuang)', () => {
		const r = planPrefetch([1, 2, 3, 4, 5], 3, none);
		expect(r.toFetch).toEqual([1, 2, 3]);
		expect(r.trimmed).toBe(2);
	});
	it('melewati salinan yang masih segar (<6 jam), mengunduh ulang yang lama', () => {
		const now = 100 * 3600000;
		const at = (id: number) => (id === 1 ? now - 3600000 : id === 2 ? now - 7 * 3600000 : null);
		const r = planPrefetch([1, 2, 3], 10, at, now);
		expect(r.toFetch).toEqual([2, 3]);
		expect(r.skippedFresh).toBe(1);
	});
	it('maxItems tak valid tetap aman', () => {
		expect(planPrefetch([1, 2], 0, none).toFetch).toEqual([1]);
	});
});
