import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RAP_CATEGORY_ALIASES, normalizeRapCategoryKey, resolveCategoryBucket, isPackingCategory } from './rapCategory';

describe('rapCategory', () => {
  it('alias utama (PRJ-06)', () => {
    expect(normalizeRapCategoryKey('man_power')).toBe('jasa');
    expect(normalizeRapCategoryKey('reimbursement')).toBe('operasional');
    expect(normalizeRapCategoryKey('Sewa Vendor')).toBe('sewa_alat');
    expect(normalizeRapCategoryKey('xyz')).toBe('lain_lain');
  });
  it('resolveCategoryBucket: kode persis menang, tak dikenal ditandai', () => {
    const ids = new Set(['operasional', 'jasa', 'sewa_alat', 'sewa_vendor', 'lain_lain']);
    expect(resolveCategoryBucket('sewa_vendor', ids)).toEqual({ bucket: 'sewa_vendor', unknown: false });
    expect(resolveCategoryBucket('man_power', ids)).toEqual({ bucket: 'jasa', unknown: false });
    expect(resolveCategoryBucket('aneh', ids)).toEqual({ bucket: 'lain_lain', unknown: true });
    expect(resolveCategoryBucket(null, ids).bucket).toBe('operasional');
    // bucket valid tapi kartunya tidak ada di master → lain_lain (tidak hilang)
    expect(resolveCategoryBucket('safety', new Set(['jasa', 'lain_lain'])).bucket).toBe('lain_lain');
  });
  it('isPackingCategory', () => {
    expect(isPackingCategory('packing_supplier')).toBe(true);
    expect(isPackingCategory('supplier')).toBe(false);
  });
  it('isi alias identik dengan erp-epi (dilewati bila repo ERP tidak ada di sebelah)', () => {
    const erp = resolve(process.cwd(), '../erp-epi/src/lib/finance/expenseTypeMap.js');
    if (!existsSync(erp)) return;
    const src = readFileSync(erp, 'utf8');
    const block = src.slice(src.indexOf('const RAP_CATEGORY_ALIASES = {'));
    const body = block.slice(block.indexOf('{'), block.indexOf('};') + 1);
    const erpMap = Function(`return (${body.replace(/\/\/.*$/gm, '')})`)();
    expect(RAP_CATEGORY_ALIASES).toEqual(erpMap);
  });
});
