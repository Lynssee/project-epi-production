import { describe, it, expect } from 'vitest';
import { evaluateSelfVerify, normalizeSelfVerifyMode } from './sjkSelfVerify';

describe('evaluateSelfVerify (salinan teruji erp-epi workshopSjkCreator.js)', () => {
	const base = { creatorIds: [5, 5, 9], actorKaryawanId: 5 };
	it('bukan pembuat → lolos', () => expect(evaluateSelfVerify({ ...base, actorKaryawanId: 77 })).toMatchObject({ allowed: true, selfDetected: false }));
	it('pembuat tanpa alasan → VERIFIKASI_SENDIRI_ALASAN_WAJIB', () => {
		const r = evaluateSelfVerify({ ...base, alasan: 'pendek' });
		expect(r).toMatchObject({ allowed: false, code: 'VERIFIKASI_SENDIRI_ALASAN_WAJIB' });
		expect(r.message).toMatch(/atasan Anda akan diberi tahu/);
	});
	it('pembuat dengan alasan ≥ 10 → boleh + notifikasi', () =>
		expect(evaluateSelfVerify({ ...base, alasan: 'Hanya saya satpam yang bertugas malam ini' })).toMatchObject({ allowed: true, needsNotify: true }));
	it('block menolak; off mematikan; SJ lama (kosong) tidak terkunci', () => {
		expect(evaluateSelfVerify({ ...base, alasan: 'alasan panjang sekali', mode: 'block' })).toMatchObject({ allowed: false, code: 'VERIFIKASI_SENDIRI_DIBLOKIR' });
		expect(evaluateSelfVerify({ ...base, mode: 'off' }).selfDetected).toBe(false);
		expect(evaluateSelfVerify({ creatorIds: [null, undefined, ''], actorKaryawanId: 5 }).allowed).toBe(true);
		expect(normalizeSelfVerifyMode('aneh')).toBe('reason');
	});
});
