import { describe, it, expect } from 'vitest';
import { hitungPilar, pilarOf, type PilarConfig } from './kpiPilar';


const cfg: PilarConfig = { mode: 'shadow', perDept: {}, globalDefault: {}, overrideMap: {} };
const targets = [
	{ name: 'Kehadiran', weight: 20, achievement: 98 },
	{ name: 'Ketepatan Laporan Harian', weight: 30, achievement: 70 },
	{ name: 'Output Teknis', weight: 50, achievement: 0 }
];
const sumber = [
	{ indikator: 'Kehadiran', data_source: 'absensi', terukur: true, skor: 100 },
	{ indikator: 'Ketepatan Laporan Harian', data_source: 'reports', terukur: true, skor: 70 },
	{ indikator: 'Output Teknis', data_source: null, terukur: false, skor: 0 }
];

describe('ess kpiPilar', () => {
	it('memetakan pilar & menormalkan bobot pilar kosong (tidak dihukum 0)', () => {
		const r = hitungPilar({ departemen: 'Finance', targets, sumber_perhitungan: sumber }, cfg)!;
		expect(r.pilars.general.score).toBe(100);
		expect(r.pilars.administrasi.score).toBe(70);
		expect(r.pilars.teknis.score).toBeNull();
		expect(r.missing).toEqual(['teknis', 'inovasi']);
		expect(r.composite).toBeCloseTo((100 * 25 + 70 * 20) / 45, 1);
	});
	it('mode off -> null; tanpa targets -> null; JSON-string & bobot per departemen', () => {
		expect(hitungPilar({ targets, sumber_perhitungan: sumber }, { ...cfg, mode: 'off' })).toBeNull();
		expect(hitungPilar({ targets: [] }, cfg)).toBeNull();
		const r = hitungPilar(
			{ departemen: 'finance', targets: JSON.stringify(targets), sumber_perhitungan: JSON.stringify(sumber) },
			{ ...cfg, perDept: { FINANCE: { general: 50, teknis: 0, administrasi: 50, inovasi: 0 } } }
		)!;
		expect(r.composite).toBe(85);
	});
	it('override UI menang atas pemetaan bawaan', () => {
		expect(pilarOf({ data_source: 'absensi', name: 'x' }, { absensi: 'inovasi' })).toBe('inovasi');
		expect(pilarOf({ data_source: null, name: 'Penilaian 360' })).toBe('inovasi');
	});
});
