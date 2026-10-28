// PC3-07 — tes KONTRAK pemilihan kasir: tabel harapan IDENTIK dengan erp-epi src/lib/server/pettyCashKasir.test.js.
import { describe, it, expect } from 'vitest';
import { isKaryawanAktif, pickKasir, noKasirMessage, kasirViaNote, type KasirCandidate } from './pettyCashKasir';

const act = (...ids: number[]) => new Set(ids.map(String));
const cand = (c: any, b: any, p: any, pb: any): KasirCandidate[] => [[c, 'custodian'], [b, 'backup'], [p, 'pusat'], [pb, 'pusat_backup']];

// Tabel harapan (SALIN persis dari erp-epi): [nama, kandidat, pemohon, aktif, hasil]
const CASES: Array<[string, KasirCandidate[], number, number[], { kasirId: number | null; via: string | null }]> = [
	['kustodian aktif', cand(1, 2, 3, 4), 9, [1, 2, 3, 4], { kasirId: 1, via: 'custodian' }],
	['kustodian = pemohon → cadangan', cand(1, 2, 3, 4), 1, [1, 2, 3, 4], { kasirId: 2, via: 'backup' }],
	['kustodian Off → cadangan', cand(1, 2, 3, 4), 9, [2, 3, 4], { kasirId: 2, via: 'backup' }],
	['kustodian & cadangan kosong → Pusat', cand(null, null, 3, 4), 9, [3, 4], { kasirId: 3, via: 'pusat' }],
	['Pusat = pemohon → cadangan Pusat', cand(null, null, 3, 4), 3, [3, 4], { kasirId: 4, via: 'pusat_backup' }],
	['semua kosong → null', cand(null, null, null, null), 9, [], { kasirId: null, via: null }],
	['semua nonaktif → null', cand(1, 2, 3, 4), 9, [], { kasirId: null, via: null }],
	['pemohon satu-satunya kandidat → null', cand(1, null, null, null), 1, [1], { kasirId: null, via: null }],
	['id string vs number tetap cocok', cand('1', 2, null, null), 9, [1], { kasirId: 1, via: 'custodian' }]
];

describe('kontrak pickKasir', () => {
	for (const [name, c, requester, active, want] of CASES) {
		it(name, () => expect(pickKasir(c, requester, act(...active))).toEqual(want));
	}
	it('pemohon null/undefined tidak menyingkirkan siapa pun', () => {
		expect(pickKasir(cand(1, null, null, null), null, act(1))).toEqual({ kasirId: 1, via: 'custodian' });
		expect(pickKasir(cand(1, null, null, null), undefined, act(1))).toEqual({ kasirId: 1, via: 'custodian' });
	});
});

describe('isKaryawanAktif', () => {
	it('hanya "Off" yang nonaktif (Kontrak/Tetap/Daily Worker/Internship/null tetap aktif)', () => {
		expect(isKaryawanAktif({ status: 'On' })).toBe(true);
		for (const s of ['Kontrak ', 'Tetap ', 'Daily Worker', 'Internship', null, undefined, '']) expect(isKaryawanAktif({ status: s }), String(s)).toBe(true);
		for (const s of ['Off', 'off', ' OFF ']) expect(isKaryawanAktif({ status: s }), s).toBe(false);
	});
});

describe('pesan', () => {
	it('noKasirMessage menyebut dana & alternatif', () => {
		expect(noKasirMessage('Petty Cash Ciketing')).toMatch(/"Petty Cash Ciketing" belum punya kasir aktif.*Pusat.*Finance/);
		expect(noKasirMessage(null)).toMatch(/^Dana belum punya kasir aktif/);
	});
	it('kasirViaNote hanya untuk pengganti', () => {
		expect(kasirViaNote('custodian', 'X')).toBe('');
		expect(kasirViaNote(null, 'X')).toBe('');
		expect(kasirViaNote('backup', 'X')).toMatch(/kasir pengganti untuk dana X/);
		expect(kasirViaNote('pusat', 'X')).toMatch(/kasir Pusat pengganti/);
	});
});
