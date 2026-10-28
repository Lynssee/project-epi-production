import { describe, it, expect } from 'vitest';
import { chipsForJenis, topRequested, mergeChips, DEFAULT_QUICK_ITEMS } from './plQuickItems';

const chip = (name: string, category = 'packing_consumable', unit = 'Pcs') => ({ name, category, unit });

describe('plQuickItems (PRJ-26)', () => {
	it('tanpa setelan -> default lama; setelan jenis menang atas "*"; entri rusak dibuang', () => {
		expect(chipsForJenis(null, 'Painting')).toEqual(DEFAULT_QUICK_ITEMS);
		const s = { Painting: [chip('Roller Cat'), { name: '', category: 'x', unit: 'y' }, 5], '*': [chip('Umum')] };
		expect(chipsForJenis(s, 'painting').map((c) => c.name)).toEqual(['Roller Cat']);
		expect(chipsForJenis(s, 'Sandblasting').map((c) => c.name)).toEqual(['Umum']);
		expect(chipsForJenis({ Painting: [] }, 'Painting')).toEqual(DEFAULT_QUICK_ITEMS);
	});
	it('topRequested: urut frekuensi, minimal 2 kali, tanpa nama/kategori kosong', () => {
		const rows = [
			{ material_name: 'Kuas 4"', budget_category: 'packing_consumable', unit: 'Pcs' },
			{ material_name: 'kuas 4"', budget_category: 'packing_consumable', unit: 'Pcs' },
			{ material_name: 'Thinner', budget_category: 'packing_supplier', unit: 'Liter' },
			{ material_name: 'Thinner', budget_category: 'packing_supplier', unit: 'Liter' },
			{ material_name: 'Thinner', budget_category: 'packing_supplier', unit: 'Liter' },
			{ material_name: 'Sekali saja', budget_category: 'packing_supplier', unit: 'Kg' },
			{ material_name: '', budget_category: 'packing_supplier' },
			{ material_name: 'Tanpa kategori' }
		];
		expect(topRequested(rows).map((c) => c.name)).toEqual(['Thinner', 'Kuas 4"']);
		expect(topRequested(rows, 1)).toHaveLength(1);
	});
	it('mergeChips: sering diminta dulu, duplikat dibuang, dibatasi', () => {
		const out = mergeChips([chip('A'), chip('b')], [chip('a'), chip('C'), chip('B')], 3);
		expect(out.map((c) => c.name)).toEqual(['A', 'b', 'C']);
	});
});
