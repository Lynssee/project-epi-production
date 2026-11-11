import { describe, it, expect } from 'vitest';
import { bacaSetelanVisit, validasiTutup, visitTertutupSah, adalahTerbuka, menitKeBatas, jamWIB, VISIT_DEFAULT } from './visitTutup';

describe('bacaSetelanVisit', () => {
	it('default dan nilai valid/tidak valid', () => {
		expect(bacaSetelanVisit(null)).toEqual(VISIT_DEFAULT);
		expect(bacaSetelanVisit({ 'visit.batas_tutup_jam': '"18:30"', 'visit.min_foto': '2', 'visit.rekap_sore_jam': '99:99' })).toEqual({
			batasJam: '18:30', pengingatMenit: 60, rekapJam: '17:30', minFoto: 2
		});
	});
});

describe('validasiTutup', () => {
	it('kegiatan dan foto', () => {
		expect(validasiTutup({ kegiatan: 'x', fotoCount: 2 }).ok).toBe(false);
		expect(validasiTutup({ kegiatan: 'Inspeksi coating', fotoCount: 0 }).ok).toBe(false);
		expect(validasiTutup({ kegiatan: 'Inspeksi coating', fotoCount: 1 }).ok).toBe(true);
		expect(validasiTutup({ kegiatan: 'Inspeksi coating', fotoCount: 0, minFoto: 0 }).ok).toBe(true);
	});
});

describe('status visit', () => {
	it('terbuka dan tertutup sah', () => {
		expect(adalahTerbuka({ status: 'in_progress' })).toBe(true);
		expect(adalahTerbuka({ status: 'closed' })).toBe(false);
		expect(visitTertutupSah({ status: 'closed', cara_tutup: 'sistem_massal' })).toBe(false);
		expect(visitTertutupSah({ status: 'closed', cara_tutup: 'leader' })).toBe(true);
		expect(visitTertutupSah({ status: 'closed' })).toBe(true);
	});
});

describe('waktu', () => {
	it('menitKeBatas dan jamWIB', () => {
		expect(menitKeBatas('16:00', '17:00')).toBe(60);
		expect(menitKeBatas('18:00', '17:00')).toBe(-60);
		expect(menitKeBatas('xx', '17:00')).toBeNull();
		expect(jamWIB(new Date('2026-11-07T09:30:00Z'))).toBe('16:30');
	});
});
