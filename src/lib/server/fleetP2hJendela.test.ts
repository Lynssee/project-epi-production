import { describe, expect, it } from 'vitest';
import { evaluasiJendelaP2h, normalizeJendelaJam, normalizeJendelaMode } from './fleetP2hJendela';

const MULAI = '2026-09-30T02:00:00Z'; // 09.00 WIB
const jamSebelum = (h: number) => new Date(new Date(MULAI).getTime() - h * 3600 * 1000).toISOString();

describe('normalisasi', () => {
	it('mode tak dikenal → soft; jam rusak → 3', () => {
		expect(normalizeJendelaMode('hard')).toBe('hard');
		expect(normalizeJendelaMode('"off"')).toBe('off');
		expect(normalizeJendelaMode(undefined)).toBe('soft');
		expect(normalizeJendelaJam('5')).toBe(5);
		for (const x of [0, -1, 'abc', null, undefined]) expect(normalizeJendelaJam(x)).toBe(3);
	});
});

describe('evaluasiJendelaP2h', () => {
	it('dalam jendela (≤ 3 jam sebelum jadwal) atau sesudah jadwal → ok', () => {
		expect(evaluasiJendelaP2h({ mulaiIso: MULAI, kejadianIso: jamSebelum(3), jendelaJam: 3, mode: 'hard' }).status).toBe('ok');
		expect(evaluasiJendelaP2h({ mulaiIso: MULAI, kejadianIso: jamSebelum(1), jendelaJam: 3, mode: 'hard' }).status).toBe('ok');
		expect(evaluasiJendelaP2h({ mulaiIso: MULAI, kejadianIso: jamSebelum(-2), jendelaJam: 3, mode: 'hard' }).status).toBe('ok');
	});
	it('U7: 1 hari sebelum jadwal, mode soft → diterima + tanda [P2H_TERLALU_AWAL]', () => {
		const r = evaluasiJendelaP2h({ mulaiIso: MULAI, kejadianIso: jamSebelum(24), jendelaJam: 3, mode: 'soft' });
		expect(r.status).toBe('terlalu_awal');
		if (r.status === 'terlalu_awal') {
			expect(r.flag).toContain('[P2H_TERLALU_AWAL]');
			expect(r.jamLebihAwal).toBe(24);
		}
	});
	it('mode hard → ditolak dengan jam jadwal dalam WIB', () => {
		const r = evaluasiJendelaP2h({ mulaiIso: MULAI, kejadianIso: jamSebelum(24), jendelaJam: 3, mode: 'hard' });
		expect(r.status).toBe('tolak');
		if (r.status === 'tolak') expect(r.pesan).toBe('Cek kendaraan maksimal 3 jam sebelum jadwal berangkat (09.00 WIB).');
	});
	it('off / tanpa jadwal / tanggal rusak → tidak pernah menghalangi', () => {
		expect(evaluasiJendelaP2h({ mulaiIso: MULAI, kejadianIso: jamSebelum(24), jendelaJam: 3, mode: 'off' }).status).toBe('ok');
		expect(evaluasiJendelaP2h({ mulaiIso: null, kejadianIso: jamSebelum(24), jendelaJam: 3, mode: 'hard' }).status).toBe('ok');
		expect(evaluasiJendelaP2h({ mulaiIso: 'ngawur', kejadianIso: jamSebelum(24), jendelaJam: 3, mode: 'hard' }).status).toBe('ok');
	});
});
