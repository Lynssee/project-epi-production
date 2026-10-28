import { describe, it, expect } from 'vitest';
import { guessPlCategory } from './plCategoryGuess';

describe('guessPlCategory (PRJ-26)', () => {
	it('kata utuh: "Catridge printer" / "Locator" BUKAN Material Supplier', () => {
		expect(guessPlCategory('Catridge printer HP')).toBeNull();
		expect(guessPlCategory('Locator pipa')).toBeNull();
	});
	it('cat/thinner/epoxy -> supplier; kuas/amplas -> consumable; helm -> safety; genset -> sewa alat', () => {
		expect(guessPlCategory('CAT EPOXY ABU-ABU')).toBe('packing_supplier');
		expect(guessPlCategory('Thinner Epoxy High Gloss')).toBe('packing_supplier');
		expect(guessPlCategory('Kuas roll 4 inch')).toBe('packing_consumable');
		expect(guessPlCategory('Helm Safety Putih')).toBe('packing_safety');
		expect(guessPlCategory('Sewa genset 5 kva')).toBe('packing_sewa_alat');
	});
	it('frasa dua kata & kosong', () => {
		expect(guessPlCategory('Sarung tangan karet')).toBe('packing_safety');
		expect(guessPlCategory('')).toBeNull();
	});
	it('setelan kustom menggantikan default', () => {
		expect(guessPlCategory('Kabel NYY', { packing_consumable: ['kabel'] })).toBe('packing_consumable');
	});
});
