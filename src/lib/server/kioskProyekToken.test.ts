import { describe, it, expect } from 'vitest';
import {
	signActivationToken,
	verifyActivationToken,
	signDeviceCookie,
	verifyDeviceCookie,
	makeKiosKode,
	normalizeKode,
	todayWIB,
	createUsedJtiStore
} from './kioskProyekToken';

const S = 'rahasia-uji-1234567890';

describe('token aktivasi', () => {
	it('sah sebelum kedaluwarsa, ditolak sesudahnya', () => {
		const t0 = 1_000_000;
		const { token, exp } = signActivationToken({ projectId: 978, leaderManpowerId: 5, ttlSeconds: 120 }, S, t0);
		expect(exp).toBe(t0 + 120_000);
		expect(verifyActivationToken(token, S, t0 + 119_000)).toMatchObject({ p: 978, l: 5 });
		expect(verifyActivationToken(token, S, t0 + 121_000)).toBeNull();
	});

	it('rahasia salah / token diubah / sampah → null', () => {
		const { token } = signActivationToken({ projectId: 1, leaderManpowerId: 2, ttlSeconds: 60 }, S);
		expect(verifyActivationToken(token, 'lain')).toBeNull();
		const [body, sig] = token.split('.');
		const forged = Buffer.from(JSON.stringify({ p: 999, l: 2, j: 'x', exp: Date.now() + 1e6 })).toString('base64url');
		expect(verifyActivationToken(`${forged}.${sig}`, S)).toBeNull();
		expect(verifyActivationToken(`${body}.${sig}.x`, S)).toBeNull();
		expect(verifyActivationToken('', S)).toBeNull();
		expect(verifyActivationToken(undefined, S)).toBeNull();
		expect(verifyActivationToken('a'.repeat(5000), S)).toBeNull();
	});

	it('token aktivasi TIDAK bisa dipakai sebagai cookie perangkat (dan sebaliknya)', () => {
		const act = signActivationToken({ projectId: 1, leaderManpowerId: 2, ttlSeconds: 60 }, S).token;
		const dev = signDeviceCookie({ deviceId: 7, projectId: 1, ttlDays: 1 }, S).value;
		expect(verifyDeviceCookie(act, S)).toBeNull();
		expect(verifyActivationToken(dev, S)).toBeNull();
	});

	it('jti sekali pakai', () => {
		const store = createUsedJtiStore();
		const { jti, exp } = signActivationToken({ projectId: 1, leaderManpowerId: 2, ttlSeconds: 60 }, S, 0);
		expect(store.consume(jti, exp, 1)).toBe(true);
		expect(store.consume(jti, exp, 2)).toBe(false);
		expect(store.consume('lain', 10, exp + 1)).toBe(true); // yang kedaluwarsa dibersihkan
		expect(store.size()).toBe(1);
	});
});

describe('cookie perangkat', () => {
	it('berlaku sesuai hari, memuat id perangkat & proyek', () => {
		const t0 = 5_000;
		const { value, exp } = signDeviceCookie({ deviceId: 42, projectId: 978, ttlDays: 30 }, S, t0);
		expect(exp).toBe(t0 + 30 * 86_400_000);
		expect(verifyDeviceCookie(value, S, t0 + 1)).toMatchObject({ d: 42, p: 978 });
		expect(verifyDeviceCookie(value, S, exp + 1)).toBeNull();
	});
});

describe('kode & tanggal', () => {
	it('kode acak 6 karakter tanpa karakter membingungkan', () => {
		for (let i = 0; i < 200; i++) expect(makeKiosKode()).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
	});
	it('normalizeKode', () => {
		expect(normalizeKode(' ab12cd ')).toBe('AB12CD');
		expect(normalizeKode('ab')).toBeNull();
		expect(normalizeKode('../etc')).toBeNull();
		expect(normalizeKode(123)).toBeNull();
	});
	it('todayWIB memakai zona Jakarta, bukan UTC', () => {
		// 2026-10-27 18:30 UTC = 2026-10-28 01:30 WIB
		expect(todayWIB(new Date('2026-10-27T18:30:00Z'))).toBe('2026-10-28');
		expect(todayWIB(new Date('2026-10-27T16:59:00Z'))).toBe('2026-10-27');
	});
});

import { kodeHarian, cocokKodeHarian, signBindToken, verifyBindToken } from './kioskProyekToken';

describe('kode harian 6 digit (Fase 3)', () => {
	it('6 digit, deterministik, berbeda per proyek / tanggal / rahasia', () => {
		const a = kodeHarian(978, '2026-10-27', S);
		expect(a).toMatch(/^\d{6}$/);
		expect(kodeHarian(978, '2026-10-27', S)).toBe(a);
		const lain = new Set([kodeHarian(979, '2026-10-27', S), kodeHarian(978, '2026-10-28', S), kodeHarian(978, '2026-10-27', 'rahasia-lain')]);
		expect(lain.has(a) && lain.size === 1).toBe(false); // tidak semua sama dengan a
	});
	it('sebaran wajar: 300 hari tidak menghasilkan satu nilai saja', () => {
		const set = new Set<string>();
		for (let d = 1; d <= 300; d++) set.add(kodeHarian(1, `2026-01-${String(d).padStart(3, '0')}`, S));
		expect(set.size).toBeGreaterThan(250);
	});
	it('cocokKodeHarian: spasi diabaikan, bukan 6 digit / bukan string ditolak', () => {
		const k = kodeHarian(978, '2026-10-27', S);
		expect(cocokKodeHarian(` ${k} `, 978, '2026-10-27', S)).toBe(true);
		expect(cocokKodeHarian(k, 978, '2026-10-28', S)).toBe(k === kodeHarian(978, '2026-10-28', S));
		expect(cocokKodeHarian('12345', 978, '2026-10-27', S)).toBe(false);
		expect(cocokKodeHarian('1234', 978, '2026-10-27', S)).toBe(false);
		expect(cocokKodeHarian('1234567', 978, '2026-10-27', S)).toBe(false);
		expect(cocokKodeHarian('abcd', 978, '2026-10-27', S)).toBe(false);
		expect(cocokKodeHarian(123456, 978, '2026-10-27', S)).toBe(false);
		expect(cocokKodeHarian(undefined, 978, '2026-10-27', S)).toBe(false);
	});
});

describe('token ikat (Fase 3)', () => {
	it('sah sebelum kedaluwarsa, tidak bisa dipakai sebagai cookie perangkat / token aktivasi', () => {
		const { token, exp } = signBindToken({ projectId: 978, ttlSeconds: 600 }, S, 1000);
		expect(exp).toBe(1000 + 600_000);
		expect(verifyBindToken(token, S, 2000)).toMatchObject({ p: 978 });
		expect(verifyBindToken(token, S, exp + 1)).toBeNull();
		expect(verifyBindToken(token, 'lain', 2000)).toBeNull();
		expect(verifyDeviceCookie(token, S, 2000)).toBeNull();
		expect(verifyActivationToken(token, S, 2000)).toBeNull();
		const dev = signDeviceCookie({ deviceId: 1, projectId: 978, ttlDays: 1 }, S).value;
		expect(verifyBindToken(dev, S)).toBeNull();
	});
});
