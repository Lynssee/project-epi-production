import { describe, it, expect } from 'vitest';
import { dewPointC, assessPainting } from './dewPoint';
import { RND_TAB_GROUPS, groupOfTab, complaintStageLabel, docRequestStatusLabel } from '../config/rndFieldTabs';

describe('dewPoint', () => {
	it('rumus Magnus mendekati nilai acuan', () => {
		expect(dewPointC(30, 70)!).toBeCloseTo(23.9, 0);
		expect(dewPointC(25, 100)!).toBeCloseTo(25, 1);
		expect(dewPointC(20, 50)!).toBeCloseTo(9.3, 0);
	});
	it('input tak valid → null', () => {
		expect(dewPointC(NaN, 50)).toBeNull();
		expect(dewPointC(25, 0)).toBeNull();
		expect(dewPointC(25, 101)).toBeNull();
		expect(assessPainting({ airTempC: 30, rhPercent: 70, substrateTempC: NaN })).toBeNull();
	});
	it('aman bila pelat ≥3 °C di atas dew point dan RH ≤85%', () => {
		const r = assessPainting({ airTempC: 30, rhPercent: 60, substrateTempC: 35 })!;
		expect(r.verdict).toBe('aman');
		expect(r.reasons).toEqual([]);
	});
	it('bahaya bila margin <3 °C (kondensasi)', () => {
		const r = assessPainting({ airTempC: 30, rhPercent: 80, substrateTempC: 28 })!;
		expect(r.verdict).toBe('bahaya');
		expect(r.reasons[0]).toMatch(/dew point/);
	});
	it('bahaya bila RH >85% walau margin cukup (amine blushing)', () => {
		const r = assessPainting({ airTempC: 30, rhPercent: 90, substrateTempC: 45 })!;
		expect(r.verdict).toBe('bahaya');
		expect(r.reasons.some((x) => /blushing/.test(x))).toBe(true);
	});
	it('ambang dapat diganti', () => {
		expect(assessPainting({ airTempC: 30, rhPercent: 60, substrateTempC: 24 }, { minMarginC: 1 })!.marginC).toBeGreaterThan(1);
	});
});

describe('rndFieldTabs', () => {
	it('12 tab terbagi di 4 kelompok tanpa duplikat; 10 tab lama tetap ada', () => {
		const ids = RND_TAB_GROUPS.flatMap((g) => g.tabs.map((t) => t.id));
		expect(RND_TAB_GROUPS).toHaveLength(4);
		expect(new Set(ids).size).toBe(ids.length);
		for (const old of ['tds', 'msds', 'b3', 'katalog', 'kompat', 'mixing', 'retensi', 'weathering', 'lapor', 'minta']) expect(ids).toContain(old);
		expect(ids).toEqual(expect.arrayContaining(['dewpoint', 'saya']));
	});
	it('groupOfTab & label', () => {
		expect(groupOfTab('mixing').id).toBe('panduan');
		expect(groupOfTab('saya').id).toBe('lapor');
		expect(groupOfTab('xxx').id).toBe('dokumen');
		expect(complaintStageLabel('akar_masalah')).toMatch(/D4/);
		expect(complaintStageLabel(null)).toBe('-');
		expect(docRequestStatusLabel('baru')).toBe('Menunggu R&D');
	});
});
