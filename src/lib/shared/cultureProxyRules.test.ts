import { describe, it, expect } from 'vitest';
import { isCultureProxyBlocked, isProxyPathHardDenied } from './cultureProxyRules';

describe('isCultureProxyBlocked (kembar erp-epi)', () => {
	it('employee_motivation_log: semua metode diblokir', () => {
		for (const m of ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE']) expect(isCultureProxyBlocked('items/employee_motivation_log', m), m).toBe(true);
		expect(isCultureProxyBlocked('/items/employee_motivation_log/3', 'get')).toBe(true);
	});
	it('ack & ikrar: tulis diblokir, baca boleh', () => {
		for (const c of ['culture_propaganda_ack', 'culture_golden_pledge']) {
			expect(isCultureProxyBlocked(`items/${c}`, 'POST')).toBe(true);
			expect(isCultureProxyBlocked(`items/${c}/1`, 'DELETE')).toBe(true);
			expect(isCultureProxyBlocked(`items/${c}`, 'GET')).toBe(false);
		}
	});
	it('koleksi lain tidak terpengaruh', () => {
		for (const c of ['culture_propaganda', 'culture_spotlight', 'company_core_values', 'employee_motivation_log_x']) {
			expect(isCultureProxyBlocked(`items/${c}`, 'POST'), c).toBe(false);
		}
		expect(isCultureProxyBlocked('', 'GET')).toBe(false);
	});
});

describe('isProxyPathHardDenied (kembar erp-epi)', () => {
	it('graphql & utils export/import ditolak; path sah lain tidak', () => {
		for (const p of ['graphql', '/graphql', 'GraphQL/system', 'utils/export/x', '/utils/import/y']) expect(isProxyPathHardDenied(p), p).toBe(true);
		for (const p of ['items/karyawan', 'files', 'assets/a', 'revisions', 'graphqlx', 'items/graphql', '']) expect(isProxyPathHardDenied(p), p).toBe(false);
	});
});
