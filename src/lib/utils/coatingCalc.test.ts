import { describe, it, expect } from 'vitest';
import { cekAplikasi, dewPoint, dftDariWft, kebutuhanCat, kehilanganTekanan, tsr, wftDariDft } from './coatingCalc';

describe('dewPoint (Magnus)', () => {
	it('30°C / 70% ≈ 24°C', () => expect(dewPoint(30, 70)).toBeCloseTo(23.9, 0));
	it('RH 100% → dew point = suhu udara', () => expect(dewPoint(25, 100)).toBeCloseTo(25, 0));
	it('menerima koma desimal & string', () => expect(dewPoint('30,0', '70')).toBeCloseTo(23.9, 0));
	it('input tak valid → null', () => {
		expect(dewPoint('', 70)).toBeNull();
		expect(dewPoint(30, 0)).toBeNull();
		expect(dewPoint(30, 120)).toBeNull();
		expect(dewPoint(undefined, null)).toBeNull();
	});
});

describe('cekAplikasi', () => {
	it('boleh: baja ≥ dew point + 3 dan RH ≤ 85', () => {
		const r = cekAplikasi(30, 70, 32)!;
		expect(r.boleh).toBe(true);
		expect(r.alasan).toEqual([]);
	});
	it('tidak boleh bila selisih < 3°C (soal kuis: baja 28 vs dew point 26)', () => {
		const r = cekAplikasi(30, 79, 28)!; // dew point ≈ 26
		expect(r.suhuOk).toBe(false);
		expect(r.boleh).toBe(false);
		expect(r.alasan[0]).toContain('minimal 3°C');
	});
	it('tidak boleh bila RH > 85 walau suhu aman', () => {
		const r = cekAplikasi(25, 90, 40)!;
		expect(r.suhuOk).toBe(true);
		expect(r.rhOk).toBe(false);
		expect(r.boleh).toBe(false);
	});
	it('input kosong → null', () => expect(cekAplikasi(30, 70, '')).toBeNull());
});

describe('WFT / DFT / TSR (contoh materi & kuis)', () => {
	it('DFT 150, %VS 60 → WFT 250', () => expect(wftDariDft(150, 60)).toBe(250));
	it('DFT 200, %VS 80 → WFT 250 (kuis P2)', () => expect(wftDariDft(200, 80)).toBe(250));
	it('thinner 5% menambah WFT', () => expect(wftDariDft(150, 60, 5)).toBe(262.5));
	it('DFT dari WFT balik normal', () => expect(dftDariWft(250, 60)).toBe(150));
	it('thinner dikoreksi saat balik ke DFT', () => expect(dftDariWft(262.5, 60, 5)).toBe(150));
	it('TSR %VS 60, DFT 150 → 4 m²/L', () => expect(tsr(60, 150)).toBe(4));
	it('TSR %VS 50, DFT 125 → 4 m²/L (kuis P2)', () => expect(tsr(50, 125)).toBe(4));
	it('%VS di luar 0–100 atau nol → null', () => {
		expect(wftDariDft(150, 0)).toBeNull();
		expect(wftDariDft(150, 120)).toBeNull();
		expect(tsr(60, 0)).toBeNull();
		expect(wftDariDft(-5, 60)).toBeNull();
	});
});

describe('kebutuhanCat', () => {
	it('200 m², TSR 4, efisiensi 0,8 → 62,5 liter (kuis P2)', () => {
		expect(kebutuhanCat(200, 60, 150, 0.8)).toEqual({ tsr: 4, psr: 3.2, liter: 62.5 });
	});
	it('efisiensi di luar 0–1 → null', () => {
		expect(kebutuhanCat(200, 60, 150, 0)).toBeNull();
		expect(kebutuhanCat(200, 60, 150, 1.5)).toBeNull();
	});
});

describe('kehilanganTekanan', () => {
	it('88 PSI di nozzle → turun 12 PSI ≈ 18% (kuis P1)', () => expect(kehilanganTekanan(88)).toEqual({ turunPsi: 12, kehilanganPersen: 18 }));
	it('tekanan ≥ ideal → 0%', () => expect(kehilanganTekanan(105)).toEqual({ turunPsi: 0, kehilanganPersen: 0 }));
	it('input tak valid → null', () => expect(kehilanganTekanan('')).toBeNull());
});
