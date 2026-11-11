import { describe, it, expect } from 'vitest';
import { sortSjItemsLikePl } from './sjItemOrder.js';

const names = (rows) => rows.map((r) => r.n).join('');

describe('PDI-67 sortSjItemsLikePl', () => {
  it('PL 5 baris A–E (id PL 10..14), SJ dibuat memilih E, B, A → tampil A, B, E', () => {
    const sj = [
      { id: 1, n: 'E', packing_list_item_id: 14 },
      { id: 2, n: 'B', packing_list_item_id: 11 },
      { id: 3, n: 'A', packing_list_item_id: 10 }
    ];
    expect(names(sortSjItemsLikePl(sj))).toBe('ABE');
  });

  it('SJ tanpa PL → urutan input (id SJ), bukan urutan array', () => {
    const sj = [{ id: 7, n: 'c' }, { id: 5, n: 'a' }, { id: 6, n: 'b' }];
    expect(names(sortSjItemsLikePl(sj))).toBe('abc');
  });

  it('SJ campuran: baris PL dulu (urut PL), lalu tambahan (urut input)', () => {
    const sj = [
      { id: 4, n: 'x', packing_list_item_id: null },
      { id: 3, n: 'B', packing_list_item_id: 12 },
      { id: 2, n: 'y' },
      { id: 1, n: 'A', packing_list_item_id: 11 }
    ];
    expect(names(sortSjItemsLikePl(sj))).toBe('AByx');
  });

  it('packing_list_item_id berupa objek relasi ({id}) dan string angka', () => {
    const sj = [
      { id: 1, n: 'B', packing_list_item_id: { id: 20 } },
      { id: 2, n: 'A', packing_list_item_id: '19' }
    ];
    expect(names(sortSjItemsLikePl(sj))).toBe('AB');
  });

  it('plOrder eksplisit menang atas id (kolom urutan PL di masa depan)', () => {
    const sj = [
      { id: 1, n: 'A', packing_list_item_id: 10 },
      { id: 2, n: 'B', packing_list_item_id: 11 }
    ];
    expect(names(sortSjItemsLikePl(sj, new Map([[10, 2], [11, 1]])))).toBe('BA');
    expect(names(sortSjItemsLikePl(sj, { 10: 2, 11: 1 }))).toBe('BA');
  });

  it('tidak mengubah array masukan; masukan bukan array → []', () => {
    const sj = [{ id: 2, n: 'b' }, { id: 1, n: 'a' }];
    const copy = [...sj];
    sortSjItemsLikePl(sj);
    expect(sj).toEqual(copy);
    expect(sortSjItemsLikePl(null)).toEqual([]);
    expect(sortSjItemsLikePl(undefined)).toEqual([]);
  });

  it('baris tanpa id tetap stabil (urutan array dipertahankan)', () => {
    const sj = [{ n: 'p' }, { n: 'q' }, { n: 'r' }];
    expect(names(sortSjItemsLikePl(sj))).toBe('pqr');
  });
});
