import { describe, it, expect } from 'vitest';
import { findUnit, normalizeUnitLabel, sameUnit, DEFAULT_UNITS } from './unitMaster';

describe('unitMaster (PRJ-26)', () => {
	it('ejaan RAP vs PL menunjuk satuan yang sama', () => {
		expect(sameUnit('m²', 'M²')).toBe(true);
		expect(sameUnit('Lbr', 'Lembar')).toBe(true);
		expect(sameUnit('m', 'M')).toBe(true);
		expect(sameUnit('m2', 'meter persegi')).toBe(true);
		expect(sameUnit('Kg', 'Liter')).toBe(false);
	});
	it('satuan dari data nyata: Unit terpisah dari Pcs; Ton/Lusin/Pasang/OH dikenal; M1 = meter', () => {
		expect(sameUnit('Unit', 'Pcs')).toBe(false);
		expect(normalizeUnitLabel('TON')).toBe('Ton');
		expect(normalizeUnitLabel('lusin')).toBe('Lusin');
		expect(normalizeUnitLabel('OH')).toBe('OH');
		expect(sameUnit('M1', 'Meter')).toBe(true);
		expect(normalizeUnitLabel('kg/set')).toBeNull();
	});
	it('label baku & tak dikenal -> null', () => {
		expect(normalizeUnitLabel('LBR')).toBe('Lembar');
		expect(normalizeUnitLabel('titik')).toBe('Titik');
		expect(normalizeUnitLabel('xyz')).toBeNull();
		expect(normalizeUnitLabel('')).toBeNull();
	});
	it('code unik & semua alias tidak bentrok antar satuan', () => {
		const seen = new Map<string, string>();
		for (const u of DEFAULT_UNITS) {
			for (const k of [u.code, u.label, ...u.aliases].map((x) => x.toLowerCase())) {
				const prev = seen.get(k);
				expect(prev === undefined || prev === u.code).toBe(true);
				seen.set(k, u.code);
			}
		}
		expect(findUnit('Zak')?.code).toBe('sak');
	});
});

import { unitOptionsFor, UNIT_LABELS } from './unitMaster';
describe('unitOptionsFor (PRJ-26)', () => {
	it('nilai lama tetap tampil; baku/kosong tidak menambah', () => {
		expect(unitOptionsFor('Kg')).toEqual(UNIT_LABELS);
		expect(unitOptionsFor('')).toEqual(UNIT_LABELS);
		expect(unitOptionsFor('LITER')).toEqual([...UNIT_LABELS, 'LITER']);
	});
});
