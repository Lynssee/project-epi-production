import { describe, it, expect } from 'vitest';
import {
	evaluateKeyBorrowGate,
	evaluateKeyHandoverGate,
	hitungRencanaKembali,
	isDalamJamKerja,
	isKunciTerlambat,
	jakartaParts,
	resolveKeyDispensation
} from './securityKeyGate';

describe('resolveKeyDispensation', () => {
	const base = { reason: '', minAlasan: 20, izinAtasanId: null, atasanIds: [5, 6], izinAtasanAktif: true };
	it('tanpa alasan & tanpa izin → tidak ada dispensasi', () => {
		const r = resolveKeyDispensation(base);
		expect(r).toEqual({ alasanCukup: false, izinAtasanValid: false, izinAtasanDitolak: false, dispensasi: false });
	});
	it('alasan cukup panjang → dispensasi', () => {
		expect(resolveKeyDispensation({ ...base, reason: 'a'.repeat(20) }).dispensasi).toBe(true);
		expect(resolveKeyDispensation({ ...base, reason: 'a'.repeat(19) }).dispensasi).toBe(false);
	});
	it('izin dari atasan langsung atau fungsional → valid', () => {
		expect(resolveKeyDispensation({ ...base, izinAtasanId: 5 }).izinAtasanValid).toBe(true);
		expect(resolveKeyDispensation({ ...base, izinAtasanId: 6 }).dispensasi).toBe(true);
	});
	it('izin dari orang yang bukan atasan → ditolak, bukan dispensasi', () => {
		const r = resolveKeyDispensation({ ...base, izinAtasanId: 99 });
		expect(r.izinAtasanValid).toBe(false);
		expect(r.izinAtasanDitolak).toBe(true);
		expect(r.dispensasi).toBe(false);
	});
	it('fitur nonaktif → izin atasan ditolak walau atasan sah', () => {
		const r = resolveKeyDispensation({ ...base, izinAtasanId: 5, izinAtasanAktif: false });
		expect(r.izinAtasanValid).toBe(false);
		expect(r.izinAtasanDitolak).toBe(true);
	});
	it('atasan null/undefined tidak pernah cocok dengan izinAtasanId kosong', () => {
		const r = resolveKeyDispensation({ ...base, atasanIds: [null, undefined] });
		expect(r.izinAtasanValid).toBe(false);
		expect(r.izinAtasanDitolak).toBe(false);
	});
	it('alasan null aman; minAlasan 0 berarti selalu cukup', () => {
		expect(resolveKeyDispensation({ ...base, reason: null }).alasanCukup).toBe(false);
		expect(resolveKeyDispensation({ ...base, reason: null, minAlasan: 0 }).alasanCukup).toBe(true);
	});
});

const OPTS = { jamKerjaMulai: 8, jamKerjaSelesai: 17 };
// 2026-11-06 03:00 UTC = 10:00 WIB (jam kerja); 15:00 UTC = 22:00 WIB (malam)
const SIANG = new Date('2026-11-06T03:00:00Z');
const MALAM = new Date('2026-11-06T15:00:00Z');

describe('jakartaParts / isDalamJamKerja', () => {
	it('konversi UTC ke WIB', () => {
		expect(jakartaParts(SIANG)).toEqual({ hour: 10, date: '2026-11-06' });
		expect(jakartaParts(new Date('2026-11-06T18:00:00Z'))).toEqual({ hour: 1, date: '2026-11-07' });
	});
	it('batas jam kerja: mulai inklusif, selesai eksklusif', () => {
		expect(isDalamJamKerja(8, 8, 17)).toBe(true);
		expect(isDalamJamKerja(16, 8, 17)).toBe(true);
		expect(isDalamJamKerja(17, 8, 17)).toBe(false);
		expect(isDalamJamKerja(7, 8, 17)).toBe(false);
	});
});

describe('evaluateKeyBorrowGate', () => {
	it('kunci biasa di jam kerja → lolos', () => {
		const r = evaluateKeyBorrowGate({ namaKunci: 'Ruang Rapat', isRestricted: false, now: SIANG, bawaPulang: false, options: OPTS });
		expect(r.passed).toBe(true);
		expect(r.violations).toEqual([]);
	});
	it('kunci biasa di malam hari tetap lolos (hanya kunci terbatas yang dibatasi jam)', () => {
		const r = evaluateKeyBorrowGate({ namaKunci: 'Ruang Rapat', isRestricted: false, now: MALAM, bawaPulang: false, options: OPTS });
		expect(r.passed).toBe(true);
	});
	it('kunci terbatas di luar jam kerja → pelanggaran', () => {
		const r = evaluateKeyBorrowGate({ namaKunci: 'Ruang Server', isRestricted: true, now: MALAM, bawaPulang: false, options: OPTS });
		expect(r.passed).toBe(false);
		expect(r.violations[0].code).toBe('KUNCI_TERBATAS_DILUAR_JAM');
		expect(r.summary).toContain('Ruang Server');
	});
	it('kunci terbatas di jam kerja → lolos', () => {
		const r = evaluateKeyBorrowGate({ namaKunci: 'Ruang Server', isRestricted: true, now: SIANG, bawaPulang: false, options: OPTS });
		expect(r.passed).toBe(true);
	});
	it('bawa pulang → pelanggaran; kombinasi dengan terbatas menghasilkan dua pelanggaran', () => {
		const r = evaluateKeyBorrowGate({ namaKunci: 'Master', isRestricted: true, now: MALAM, bawaPulang: true, options: OPTS });
		expect(r.violations.map((v) => v.code)).toEqual(['KUNCI_TERBATAS_DILUAR_JAM', 'KUNCI_DIBAWA_PULANG']);
	});
	it('nama kosong tidak crash', () => {
		const r = evaluateKeyBorrowGate({ namaKunci: '', isRestricted: false, now: SIANG, bawaPulang: true, options: OPTS });
		expect(r.passed).toBe(false);
		expect(r.summary).toContain('kunci');
	});
});

describe('evaluateKeyHandoverGate', () => {
	it('null (gagal baca) → lolos (fail-open)', () => {
		expect(evaluateKeyHandoverGate({ outstanding: null }).passed).toBe(true);
		expect(evaluateKeyHandoverGate({ outstanding: undefined }).passed).toBe(true);
	});
	it('tidak ada kunci keluar → lolos', () => {
		const r = evaluateKeyHandoverGate({ outstanding: [] });
		expect(r.passed).toBe(true);
		expect(r.summary).toMatch(/sudah kembali/);
	});
	it('kunci overnight_ijin tidak dihitung', () => {
		const r = evaluateKeyHandoverGate({ outstanding: [{ kode: 'KC-1', nama: 'Hilux', status: 'overnight_ijin' }] });
		expect(r.passed).toBe(true);
	});
	it('kunci dipinjam → pelanggaran dengan daftar', () => {
		const r = evaluateKeyHandoverGate({
			outstanding: [
				{ kode: 'KC-1', nama: 'Hilux', status: 'dipinjam' },
				{ kode: 'KC-2', nama: 'Gudang', status: 'overnight_ijin' }
			]
		});
		expect(r.passed).toBe(false);
		expect(r.violations).toHaveLength(1);
		expect(r.summary).toContain('1 kunci');
		expect(r.summary).toContain('KC-1 Hilux');
		expect(r.summary).not.toContain('KC-2');
	});
	it('kunci di slot belum dicek fisik → pelanggaran terpisah, bisa bersamaan dengan belum kembali', () => {
		const r = evaluateKeyHandoverGate({
			outstanding: [{ kode: 'KC-1', nama: 'Hilux', status: 'dipinjam' }],
			belumDicek: [{ kode: 'KC-9', nama: 'Gudang', status: 'tersedia' }]
		});
		expect(r.violations.map((v) => v.code)).toEqual(['KUNCI_MASIH_DIPINJAM', 'KUNCI_BELUM_DICEK']);
		expect(r.summary).toContain('belum dicek fisik: KC-9 Gudang');
	});
	it('hanya belum dicek (tidak ada yang dipinjam) → tetap pelanggaran', () => {
		const r = evaluateKeyHandoverGate({ outstanding: [], belumDicek: [{ kode: 'KC-9', nama: 'x', status: 'tersedia' }] });
		expect(r.passed).toBe(false);
		expect(r.violations).toHaveLength(1);
	});
	it('belumDicek null/kosong tidak mengubah hasil', () => {
		expect(evaluateKeyHandoverGate({ outstanding: [], belumDicek: null }).passed).toBe(true);
		expect(evaluateKeyHandoverGate({ outstanding: [], belumDicek: [] }).passed).toBe(true);
	});
	it('daftar dipotong 5 + "lainnya"', () => {
		const outstanding = Array.from({ length: 8 }, (_, i) => ({ kode: `K${i}`, nama: 'x', status: 'dipinjam' }));
		const r = evaluateKeyHandoverGate({ outstanding });
		expect(r.summary).toContain('8 kunci');
		expect(r.summary).toContain('dan 3 lainnya');
	});
});

describe('hitungRencanaKembali', () => {
	it('default: hari ini jam 17 WIB bila belum lewat', () => {
		const r = hitungRencanaKembali({ now: SIANG, jamDefault: 17 });
		expect(r.error).toBeUndefined();
		expect(r.rencana.toISOString()).toBe('2026-11-06T10:00:00.000Z'); // 17:00 WIB
		expect(r.bawaPulang).toBe(false);
	});
	it('default sudah lewat → 2 jam dari sekarang', () => {
		const r = hitungRencanaKembali({ now: MALAM, jamDefault: 17 });
		expect(r.rencana.getTime()).toBe(MALAM.getTime() + 2 * 3600_000);
	});
	it('jam 24 = 23:59 WIB hari yang sama, bukan bawa pulang', () => {
		const r = hitungRencanaKembali({ now: SIANG, jamDefault: 24 });
		expect(r.rencana.toISOString()).toBe('2026-11-06T16:59:00.000Z');
		expect(r.bawaPulang).toBe(false);
	});
	it('jam default tidak valid dikembalikan ke rentang aman', () => {
		const r = hitungRencanaKembali({ now: SIANG, jamDefault: Number.NaN });
		expect(r.error).toBeUndefined();
		expect(r.rencana.toISOString()).toBe('2026-11-06T10:00:00.000Z');
	});
	it('diminta di hari berikutnya → bawa pulang', () => {
		const r = hitungRencanaKembali({ now: SIANG, jamDefault: 17, diminta: '2026-11-07T01:00:00Z' });
		expect(r.error).toBeUndefined();
		expect(r.bawaPulang).toBe(true);
	});
	it('diminta lewat tengah malam WIB walau < 24 jam → bawa pulang', () => {
		const r = hitungRencanaKembali({ now: MALAM, jamDefault: 17, diminta: '2026-11-06T18:00:00Z' }); // 01:00 WIB besok
		expect(r.bawaPulang).toBe(true);
	});
	it('diminta tidak valid / masa lalu / terlalu jauh → error', () => {
		expect(hitungRencanaKembali({ now: SIANG, jamDefault: 17, diminta: 'bukan-tanggal' }).error).toMatch(/tidak valid/);
		expect(hitungRencanaKembali({ now: SIANG, jamDefault: 17, diminta: '2026-11-06T02:00:00Z' }).error).toMatch(/masa depan/);
		expect(hitungRencanaKembali({ now: SIANG, jamDefault: 17, diminta: '2026-11-20T00:00:00Z' }).error).toMatch(/maksimal 72/);
	});
});

describe('isKunciTerlambat', () => {
	const rencana = '2026-11-06T10:00:00Z';
	it('belum lewat tenggang → tidak terlambat', () => {
		expect(isKunciTerlambat(rencana, new Date('2026-11-06T10:20:00Z'), 30)).toBe(false);
	});
	it('lewat tenggang → terlambat', () => {
		expect(isKunciTerlambat(rencana, new Date('2026-11-06T10:31:00Z'), 30)).toBe(true);
	});
	it('batas kosong / tidak valid / tenggang negatif aman', () => {
		expect(isKunciTerlambat(null, SIANG, 30)).toBe(false);
		expect(isKunciTerlambat('xx', SIANG, 30)).toBe(false);
		expect(isKunciTerlambat(rencana, new Date('2026-11-06T10:01:00Z'), -5)).toBe(true);
	});
});
