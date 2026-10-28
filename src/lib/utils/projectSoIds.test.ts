import { describe, it, expect } from 'vitest';
import { buildProjectSoIdList, dedupeById, sumNilaiPo } from './projectSoIds';

describe('buildProjectSoIdList', () => {
	it('PO utama dulu lalu saudara; unik', () => {
		expect(buildProjectSoIdList({ so_customer_id: 2000 }, [{ id: 2000 }, { id: 1998 }])).toEqual([2000, 1998]);
	});
	it('so_customer_id berupa objek relasi / string; id saudara berupa angka polos', () => {
		expect(buildProjectSoIdList({ so_customer_id: { id: 2000 } }, [1998])).toEqual([2000, 1998]);
		expect(buildProjectSoIdList({ so_customer_id: '2000' }, [{ id: '1998' }])).toEqual([2000, 1998]);
	});
	it('proyek 1-PO tanpa saudara → 1 elemen (perilaku lama tidak berubah)', () => {
		expect(buildProjectSoIdList({ so_customer_id: 3000 }, [])).toEqual([3000]);
		expect(buildProjectSoIdList({ so_customer_id: 3000 }, undefined)).toEqual([3000]);
	});
	it('tanpa PO utama tetapi ada saudara (proyek dibuat dari SO lewat so_customer.project_id) → saudara saja', () => {
		expect(buildProjectSoIdList({ so_customer_id: null }, [{ id: 5 }])).toEqual([5]);
	});
	it('input kosong/rusak → []', () => {
		expect(buildProjectSoIdList(null, null)).toEqual([]);
		expect(buildProjectSoIdList({}, [null, undefined, {}, { id: '' }, { id: 'abc' }])).toEqual([]);
	});
});

describe('dedupeById / sumNilaiPo', () => {
	it('dedupeById membuang id ganda, menjaga urutan, mengabaikan null', () => {
		expect(dedupeById([{ id: 1, a: 'x' }, null, { id: 2 }, { id: 1, a: 'dup' }]).map((r) => r.id)).toEqual([1, 2]);
		expect(dedupeById(undefined as any)).toEqual([]);
	});
	it('sumNilaiPo menjumlah semua PO; kosong/NaN = 0', () => {
		expect(sumNilaiPo([{ nilai_po: '341075000' }, { nilai_po: 160898200 }, { nilai_po: null }, { nilai_po: 'x' }, {}])).toBe(501973200);
		expect(sumNilaiPo(undefined)).toBe(0);
	});
});
