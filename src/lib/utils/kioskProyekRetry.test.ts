import { describe, it, expect } from 'vitest';
import { bisaDiulang, buatTxnId, lokasiMasihSegar, txnIdValid } from './kioskProyekRetry';

describe('bisaDiulang', () => {
	it('jaringan putus / 5xx / 408 / 429 layak diulang dengan payload sama', () => {
		for (const s of [0, null, undefined, 500, 502, 503, 504, 408, 429]) expect(bisaDiulang(s as any)).toBe(true);
	});
	it('penolakan karena isi (4xx lain) TIDAK diulang: foto ganda 422, di luar jam 422, terkunci 409/423, izin 403, tak sah 401', () => {
		for (const s of [400, 401, 403, 404, 409, 413, 422, 423]) expect(bisaDiulang(s)).toBe(false);
	});
});

describe('lokasiMasihSegar', () => {
	it('segar dalam 3 menit; lebih lama, kosong, atau waktu mundur → tidak', () => {
		const t = 1_000_000;
		expect(lokasiMasihSegar(t, t + 60_000)).toBe(true);
		expect(lokasiMasihSegar(t, t + 180_000)).toBe(true);
		expect(lokasiMasihSegar(t, t + 180_001)).toBe(false);
		expect(lokasiMasihSegar(null, t)).toBe(false);
		expect(lokasiMasihSegar(NaN, t)).toBe(false);
		expect(lokasiMasihSegar(t + 5, t)).toBe(false);
	});
});

describe('txn id', () => {
	it('dibuat unik dan lolos validasi; sampah ditolak', () => {
		const a = buatTxnId();
		expect(a).not.toBe(buatTxnId());
		expect(txnIdValid(a)).toBe(true);
		for (const x of ['', 'pendek', 'a'.repeat(65), 'ada spasi di sini', '../../etc', 123, null]) expect(txnIdValid(x)).toBe(false);
	});
});
