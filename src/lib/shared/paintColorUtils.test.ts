// src/lib/shared/paintColorUtils.test.ts
import { describe, it, expect } from 'vitest';
import {
	isPaintItem,
	isClearPaint,
	isExemptPaintItem,
	getDefaultPaintColor,
	cleanColor
} from './paintColorUtils';

describe('paintColorUtils (project-epi)', () => {
	it('mengidentifikasi FOXAFLOOR CLEAR : OX - 9251 sebagai cat clear', () => {
		const name = 'FOXAFLOOR CLEAR : OX - 9251';
		expect(isPaintItem(name)).toBe(true);
		expect(isClearPaint(name)).toBe(true);
		expect(getDefaultPaintColor(name)).toBe('Clear / Bening');
	});

	it('mengidentifikasi FOXA 955 sebagai cat berwarna', () => {
		const name = 'FOXA 955';
		expect(isPaintItem(name)).toBe(true);
		expect(isClearPaint(name)).toBe(false);
	});

	it('mengidentifikasi THINNER CUCI dan TALC sebagai exempt', () => {
		expect(isExemptPaintItem('THINNER CUCI')).toBe(true);
		expect(isPaintItem('THINNER CUCI')).toBe(false);
		expect(isExemptPaintItem('TALC')).toBe(true);
		expect(isPaintItem('TALC')).toBe(false);
	});

	it('cleanColor membersihkan strip dan string kosong', () => {
		expect(cleanColor('-')).toBeNull();
		expect(cleanColor('')).toBeNull();
		expect(cleanColor('   ')).toBeNull();
		expect(cleanColor('RAL 7035')).toBe('RAL 7035');
	});
});
