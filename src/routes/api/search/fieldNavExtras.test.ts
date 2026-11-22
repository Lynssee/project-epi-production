// src/routes/api/search/fieldNavExtras.test.ts
import { describe, it, expect } from 'vitest';
import { searchExtraFieldNav } from './fieldNavExtras';

describe('Fase 1: fieldNavExtras (Dashboard Lapangan)', () => {
	it('menemukan /ess/budaya saat mencari "visi misi" bagi user berizin access_ess', () => {
		const res = searchExtraFieldNav('visi misi', ['access_ess'], false);
		expect(res.some((r) => r.url === '/ess/budaya')).toBe(true);
	});

	it('menyaring rute ESS bila user tidak punya permission access_ess', () => {
		const res = searchExtraFieldNav('visi misi', [], false);
		expect(res.some((r) => r.url === '/ess/budaya')).toBe(false);
	});

	it('mengizinkan semua rute untuk super admin', () => {
		const res = searchExtraFieldNav('visi misi', ['*'], true);
		expect(res.some((r) => r.url === '/ess/budaya')).toBe(true);
	});

	it('menangani typo "rport" dan sinonim "jobdesc" & "tbm"', () => {
		const rport = searchExtraFieldNav('rport', ['input_laporan'], false);
		expect(rport.some((r) => r.url === '/laporan/general')).toBe(true);

		const jobdesc = searchExtraFieldNav('jobdesc', ['access_ess'], false);
		expect(jobdesc.some((r) => r.url === '/ess/jobdesc')).toBe(true);
	});
});
