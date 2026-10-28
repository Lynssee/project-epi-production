import { describe, it, expect } from 'vitest';
import { isSafeInternalHref, applyRoutingOverride } from './moneyRouting';

const base = { label: 'Biaya Lapangan', href: '/biaya-lapangan', why: 'bawaan' };

describe('moneyRouting (lapangan, PRJ-29)', () => {
	it('hanya jalur internal yang aman', () => {
		expect(isSafeInternalHref('/anggaran')).toBe(true);
		for (const bad of ['https://x.test', '//x.test', 'javascript:1', 'anggaran', '/a b', undefined]) expect(isSafeInternalHref(bad)).toBe(false);
	});
	it('override sah menimpa; href tidak aman diabaikan; kosong/null memakai bawaan', () => {
		expect(applyRoutingOverride(base, { label: ' Baru ', href: '/x', why: 'alasan' })).toEqual({ label: 'Baru', href: '/x', why: 'alasan' });
		expect(applyRoutingOverride(base, { href: 'https://evil.test', label: 'L' })).toEqual({ label: 'L', href: '/biaya-lapangan', why: 'bawaan' });
		expect(applyRoutingOverride(base, undefined)).toBe(base);
		expect(applyRoutingOverride(base, { label: '', why: '  ' })).toEqual(base);
	});
});

import { canAddManualAktualisasi } from './moneyRouting';
describe('canAddManualAktualisasi (PRJ-29)', () => {
	it('bawaan/warn: semua boleh', () => {
		expect(canAddManualAktualisasi(undefined, 'leader')).toEqual({ allowed: true, mode: 'warn' });
		expect(canAddManualAktualisasi({ mode: 'warn', allowed_roles: ['admin'] }, 'leader').allowed).toBe(true);
	});
	it('restrict: hanya role terdaftar; daftar kosong tidak mengunci siapa pun', () => {
		const s = { mode: 'restrict', allowed_roles: ['admin_project', 'finance'] };
		expect(canAddManualAktualisasi(s, 'finance').allowed).toBe(true);
		expect(canAddManualAktualisasi(s, 'leader')).toEqual({ allowed: false, mode: 'restrict' });
		expect(canAddManualAktualisasi(s, null).allowed).toBe(false);
		expect(canAddManualAktualisasi({ mode: 'restrict', allowed_roles: [] }, 'leader').allowed).toBe(true);
	});
});
