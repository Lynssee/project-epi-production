import { describe, it, expect } from 'vitest';
import { hitungLapis, hitungKebutuhan } from './kebutuhanCat';

describe('hitungLapis', () => {
	it('rumus baku: SV 60%, DFT 100 µm → 6 m²/L teoritis; loss 30% → 4.2 m²/L; 100 m² → 23.81 L', () => {
		const r = hitungLapis(100, 30, { dftUm: 100, solidVolumePct: 60 });
		expect(r).toMatchObject({ valid: true, dayaSebarTeoritis: 6, dayaSebarPraktis: 4.2, liter: 23.81, wftUm: 166.7 });
	});
	it('kaleng dibulatkan ke atas', () => {
		expect(hitungLapis(100, 30, { dftUm: 100, solidVolumePct: 60 }, 20).kaleng).toBe(2);
		expect(hitungLapis(42, 0, { dftUm: 100, solidVolumePct: 60 }, 7).kaleng).toBe(1); // tepat 7 L → 1 kaleng
	});
	it('input tidak valid → valid:false dengan alasan, tanpa NaN/Infinity', () => {
		for (const [l, a] of [[{ dftUm: 0, solidVolumePct: 50 }, 100], [{ dftUm: 100, solidVolumePct: 0 }, 100], [{ dftUm: 100, solidVolumePct: 150 }, 100], [{ dftUm: 100, solidVolumePct: 50 }, 0]] as const) {
			const r = hitungLapis(a, 10, l as any);
			expect(r.valid).toBe(false);
			expect(r.alasan).toBeTruthy();
			expect(Number.isFinite(r.liter)).toBe(true);
		}
	});
	it('loss dibatasi 0–90 % (tidak membagi nol / negatif)', () => {
		expect(hitungLapis(10, 100, { dftUm: 100, solidVolumePct: 50 }).valid).toBe(true);
		expect(Number.isFinite(hitungLapis(10, 100, { dftUm: 100, solidVolumePct: 50 }).liter)).toBe(true);
		expect(hitungLapis(10, -20, { dftUm: 100, solidVolumePct: 50 }).dayaSebarPraktis).toBe(5);
	});
	it('menerima koma desimal dan null tanpa melempar', () => {
		expect(hitungLapis('100' as any, '30' as any, { dftUm: '100,0' as any, solidVolumePct: '60' as any }).liter).toBe(23.81);
		expect(() => hitungLapis(null as any, null as any, null as any)).not.toThrow();
	});
});

describe('hitungKebutuhan', () => {
	const l1 = { nama: 'Primer', dftUm: 50, solidVolumePct: 60 };
	const l2 = { nama: 'Finish', dftUm: 100, solidVolumePct: 60 };
	it('menjumlahkan lapis, thinner dari % total, kaleng dari total liter', () => {
		const r = hitungKebutuhan({ luasM2: 100, lossPct: 30, lapis: [l1, l2], thinnerPct: 10, kemasanLiter: 20 });
		expect(r.valid).toBe(true);
		expect(r.totalLiter).toBe(35.71); // 11.90 + 23.81
		expect(r.totalThinnerLiter).toBe(3.57);
		expect(r.totalKaleng).toBe(2);
	});
	it('tanpa lapis / ada lapis tidak valid → valid:false dengan pesan', () => {
		expect(hitungKebutuhan({ luasM2: 10, lossPct: 0, lapis: [] }).valid).toBe(false);
		const r = hitungKebutuhan({ luasM2: 10, lossPct: 0, lapis: [l1, { dftUm: 0, solidVolumePct: 50 }] });
		expect(r.valid).toBe(false);
		expect(r.pesan).toContain('DFT');
		expect(r.totalKaleng).toBeNull();
	});
	it('aman terhadap input undefined', () => {
		expect(() => hitungKebutuhan(undefined as any)).not.toThrow();
	});
});
