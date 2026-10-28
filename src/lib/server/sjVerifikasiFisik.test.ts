import { describe, it, expect } from 'vitest';
import { normalizeVerifikasiFisik as n } from './sjVerifikasiFisik';

const items = [{ id: 1, nama_barang: 'A', qty_delivered: 10 }, { id: 2, nama_barang: 'B', qty_delivered: 4 }];

describe('normalizeVerifikasiFisik (SJH-02, salinan erp-epi)', () => {
	it('semua sesuai → penuh', () => {
		expect(n(items, [{ sj_item_id: 1, status: 'sesuai' }, { sj_item_id: 2, status: 'sesuai' }])).toMatchObject({ ok: true, mode: 'penuh' });
	});
	it('item belum dipilih → ditolak', () => {
		expect(n(items, [{ sj_item_id: 1, status: 'sesuai' }]).ok).toBe(false);
	});
	it('qty koreksi di luar rentang → ditolak; tidak_dimuat → parsial', () => {
		expect(n(items, [{ sj_item_id: 1, status: 'qty_dikoreksi', qty_confirmed: 11 }, { sj_item_id: 2, status: 'sesuai' }]).ok).toBe(false);
		expect(n(items, [{ sj_item_id: 1, status: 'tidak_dimuat' }, { sj_item_id: 2, status: 'sesuai' }])).toMatchObject({ ok: true, mode: 'parsial' });
	});
});
