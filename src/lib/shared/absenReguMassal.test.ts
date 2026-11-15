import { describe, it, expect } from 'vitest';
import {
	parseEntriMassal,
	normalisasiSetelanMassal,
	tanggalBolehDicatat,
	tanggalWIB,
	ringkasHasil,
	statusButuhBukti,
	SETELAN_MASSAL_DEFAULT
} from './absenReguMassal';

const e = (m: number, s = 'hadir') => ({ assignment_id: m * 10, manpower_id: m, status: s });

describe('parseEntriMassal', () => {
	it('menerima string JSON dan array', () => {
		const r = parseEntriMassal(JSON.stringify([e(1), e(2, 'izin')]), 60);
		expect(r.ok && r.entries.map((x) => x.manpower_id)).toEqual([1, 2]);
		expect(parseEntriMassal([e(1)], 60).ok).toBe(true);
	});
	it('menolak JSON rusak, kosong, melebihi batas, status asing, duplikat', () => {
		expect(parseEntriMassal('{x', 60).ok).toBe(false);
		expect(parseEntriMassal([], 60).ok).toBe(false);
		expect(parseEntriMassal([e(1), e(2), e(3)], 2).ok).toBe(false);
		expect(parseEntriMassal([e(1, 'libur')], 60).ok).toBe(false);
		const dup = parseEntriMassal([e(1), e(1, 'izin')], 60);
		expect(dup.ok).toBe(false);
		if (!dup.ok) expect(dup.error).toMatch(/dua kali/);
	});
	it('menolak id bukan bilangan bulat', () => {
		expect(parseEntriMassal([{ assignment_id: 'a', manpower_id: 1, status: 'hadir' }], 60).ok).toBe(false);
	});
});

describe('normalisasiSetelanMassal', () => {
	it('kosong → default', () => {
		expect(normalisasiSetelanMassal(null)).toEqual(SETELAN_MASSAL_DEFAULT);
	});
	it('membaca nilai string JSON dan menolak di luar rentang', () => {
		const s = normalisasiSetelanMassal({
			'manpower.absen_regu_massal.aktif': 'false',
			'manpower.absen_regu_massal.min_anggota': '"8"',
			'manpower.absen_regu_massal.maks_per_kirim': 9999
		});
		expect(s).toEqual({ aktif: false, minAnggota: 8, maksPerKirim: SETELAN_MASSAL_DEFAULT.maksPerKirim });
	});
});

describe('tanggalBolehDicatat', () => {
	const now = new Date('2026-11-06T03:00:00Z'); // 10:00 WIB
	it('hari ini boleh, besok tidak', () => {
		expect(tanggalWIB(now)).toBe('2026-11-06');
		expect(tanggalBolehDicatat('2026-11-06', 7, now).ok).toBe(true);
		expect(tanggalBolehDicatat('2026-11-07', 7, now).ok).toBe(false);
	});
	it('batas susulan', () => {
		expect(tanggalBolehDicatat('2026-10-30', 7, now).ok).toBe(true);
		expect(tanggalBolehDicatat('2026-10-29', 7, now).ok).toBe(false);
	});
	it('pukul 23:30 UTC sudah hari berikutnya di WIB', () => {
		expect(tanggalWIB(new Date('2026-11-05T23:30:00Z'))).toBe('2026-11-06');
	});
});

describe('ringkasHasil & statusButuhBukti', () => {
	it('merangkum per status dan gagal', () => {
		const r = ringkasHasil([
			{ manpower_id: 1, ok: true, hasil: 'tercatat', status: 'hadir', message: '' },
			{ manpower_id: 2, ok: true, hasil: 'sudah', status: 'hadir', message: '' },
			{ manpower_id: 3, ok: false, hasil: 'gagal', status: 'izin', message: 'x' }
		]);
		expect(r).toEqual({ total: 3, berhasil: 2, gagal: 1, sudah: 1, per_status: { hadir: 2 } });
	});
	it('hanya hadir/setengah hari butuh bukti', () => {
		expect(statusButuhBukti('hadir')).toBe(true);
		expect(statusButuhBukti('sakit')).toBe(false);
	});
});
