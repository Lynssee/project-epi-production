import { describe, it, expect, vi, beforeEach } from 'vitest';

let respon: any; let gagal = false; let terakhir: any = null;
vi.mock('@directus/sdk', () => ({ readItems: (koleksi: string, opsi: any) => ({ koleksi, opsi }) }));
vi.mock('./directus', () => ({ default: { request: vi.fn(async (q: any) => { terakhir = q; if (gagal) throw new Error('403'); return respon; }) } }));
vi.mock('./secureDirectus', () => ({ getIdToken: vi.fn() }));

const { getBudgetCategoryPoSettings, getNamaAkunCoa, PO_ARAH_DEFAULT } = await import('./budgetCategory');

beforeEach(() => { gagal = false; terakhir = null; respon = []; });

describe('getBudgetCategoryPoSettings (FIN-23, fail-soft)', () => {
	it('memetakan kode -> wajib_po & hint; null/false dianggap tidak wajib', async () => {
		respon = [{ kode: 'sewa_alat', wajib_po: true, po_arah_hint: 'Buat PO sewa dulu' }, { kode: 'operasional', wajib_po: false }, { kode: 'x', wajib_po: null }];
		const m = await getBudgetCategoryPoSettings();
		expect(m.sewa_alat).toEqual({ wajib_po: true, po_arah_hint: 'Buat PO sewa dulu' });
		expect(m.operasional).toEqual({ wajib_po: false, po_arah_hint: null });
		expect(m.x.wajib_po).toBe(false);
		expect(terakhir.koleksi).toBe('budget_category_config');
		expect(terakhir.opsi.fields).toEqual(['kode', 'wajib_po', 'po_arah_hint']);
	});
	it('kolom belum ada / error -> peta kosong (tidak ada kewajiban), tidak melempar', async () => {
		gagal = true;
		expect(await getBudgetCategoryPoSettings()).toEqual({});
	});
});

describe('getNamaAkunCoa', () => {
	it('memetakan kode -> nama; kosong tanpa query; error -> kosong', async () => {
		expect(await getNamaAkunCoa([])).toEqual({});
		expect(terakhir).toBeNull();
		respon = [{ account_code: '5130-015', account_name: 'Biaya Sewa Alat & Mesin Proyek' }];
		expect(await getNamaAkunCoa(['5130-015', '5130-015'])).toEqual({ '5130-015': 'Biaya Sewa Alat & Mesin Proyek' });
		expect(terakhir.opsi.filter.account_code._in).toEqual(['5130-015']);
		gagal = true;
		expect(await getNamaAkunCoa(['1'])).toEqual({});
	});
	it('teks arahan bawaan menyebut PR/PO', () => { expect(PO_ARAH_DEFAULT).toMatch(/PR\/PO/); });
});
