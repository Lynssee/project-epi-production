import { describe, expect, it } from 'vitest';
import { evalRndJalur, parseRndCertLevels, DEFAULT_RND_CERT_LEVELS } from './rndJalur.js';

const L = (k: string, status = 'Lulus', exp: string | null = null) => ({ program_kode: k, status, sertifikat_expired: exp });
const today = new Date('2026-11-19');

describe('rndJalur (salinan inti)', () => {
	it('tanpa enrollment → next onboarding', () => {
		const r = evalRndJalur({ enrollments: [], today });
		expect(r.current).toBeNull();
		expect(r.next).toBe('onboarding');
	});
	it('prasyarat dihormati & kedaluwarsa tidak dihitung', () => {
		expect(evalRndJalur({ enrollments: [L('KUR-RND-T2'), L('KUR-RND-T4')], today }).achievedKeys).toEqual(['onboarding']);
		expect(evalRndJalur({ enrollments: [L('KUR-RND-T4', 'Lulus', '2026-01-01')], today }).achievedKeys).toEqual([]);
	});
	it('JSON rusak → default', () => {
		expect(parseRndCertLevels('{bad')).toBe(DEFAULT_RND_CERT_LEVELS);
	});
});
