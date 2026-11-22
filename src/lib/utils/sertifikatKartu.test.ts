import { describe, it, expect } from 'vitest';
import { statusSertifikat, selisihHari, urutkanKartu, ringkasKartu, type StatusSertifikat } from './sertifikatKartu';

describe('statusSertifikat', () => {
	const today = '2026-11-20';
	it('tanpa tanggal kedaluwarsa = tanpa_batas', () => {
		expect(statusSertifikat(null, today)).toBe('tanpa_batas');
		expect(statusSertifikat(undefined, today)).toBe('tanpa_batas');
	});
	it('tanggal rusak tidak dianggap kedaluwarsa', () => expect(statusSertifikat('bukan-tanggal', today)).toBe('tanpa_batas'));
	it('lewat = kedaluwarsa; hari ini masih berlaku', () => {
		expect(statusSertifikat('2026-11-19', today)).toBe('kedaluwarsa');
		expect(statusSertifikat('2026-11-20', today)).toBe('segera_habis');
	});
	it('ambang peringatan 30 hari (bisa diatur)', () => {
		expect(statusSertifikat('2026-12-20', today)).toBe('segera_habis'); // 30 hari
		expect(statusSertifikat('2026-12-21', today)).toBe('aktif'); // 31 hari
		expect(statusSertifikat('2026-12-21', today, 60)).toBe('segera_habis');
	});
	it('menerima timestamp ISO penuh', () => expect(statusSertifikat('2026-11-19T00:00:00.000Z', today)).toBe('kedaluwarsa'));
});

describe('selisihHari', () => {
	it('lintas bulan/tahun', () => {
		expect(selisihHari('2026-12-31', '2027-01-02')).toBe(2);
		expect(selisihHari('2026-03-01', '2026-02-28')).toBe(-1);
	});
});

describe('urutkanKartu & ringkasKartu', () => {
	const k = (judul: string, status: StatusSertifikat, sisaHari: number | null) => ({ judul, status, sisaHari });
	it('perhatian dulu, lalu yang paling cepat habis', () => {
		const out = urutkanKartu([k('C', 'aktif', 200), k('A', 'tanpa_batas', null), k('B', 'segera_habis', 5), k('D', 'kedaluwarsa', -3), k('E', 'segera_habis', 2)]);
		expect(out.map((x) => x.judul)).toEqual(['D', 'E', 'B', 'C', 'A']);
	});
	it('null/undefined aman', () => {
		expect(urutkanKartu(undefined)).toEqual([]);
		expect(ringkasKartu(null)).toEqual({ total: 0, aktif: 0, segeraHabis: 0, kedaluwarsa: 0 });
	});
	it('ringkasan', () => {
		expect(ringkasKartu([k('a', 'aktif', 1), k('b', 'tanpa_batas', null), k('c', 'segera_habis', 1), k('d', 'kedaluwarsa', -1)] as any)).toEqual({ total: 4, aktif: 2, segeraHabis: 1, kedaluwarsa: 1 });
	});
});
