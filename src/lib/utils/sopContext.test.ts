import { describe, it, expect } from 'vitest';
import { DEFAULT_CONTEXT, FIELD_TAB_TO_CONTEXT_KEY, normalizeEntry, normalizeStored, resolveContext, contextKeyForFieldTab } from './sopContext';

describe('sopContext (lapangan)', () => {
	it('bawaan valid; setiap padanan tab punya kunci string', () => {
		for (const e of Object.values(DEFAULT_CONTEXT)) expect(normalizeEntry(e)).toMatchObject({ sops: e.sops, gates: e.gates });
		for (const k of Object.values(FIELD_TAB_TO_CONTEXT_KEY)) expect(typeof k).toBe('string');
	});
	it('normalizeEntry membuang tak valid & duplikat', () => {
		expect(normalizeEntry({ sops: ['SOP-PRJ-009', 'SOP-PRJ-009', '<x>'], gates: ['G_OK_1', 'salah'], catatan: ' a ' })).toEqual({ sops: ['SOP-PRJ-009'], gates: ['G_OK_1'], catatan: 'a' });
		expect(normalizeEntry(null)).toEqual({ sops: [], gates: [], catatan: '' });
	});
	it('normalizeStored toleran JSON rusak', () => {
		expect(normalizeStored('{x')).toEqual({});
		expect(normalizeStored([1])).toEqual({});
		expect(Object.keys(normalizeStored({ 'Tab X': {}, ok: {} }))).toEqual(['ok']);
	});
	it('resolveContext: tersimpan > bawaan > kosong', () => {
		expect(resolveContext(null, 'manpower').sumber).toBe('bawaan');
		expect(resolveContext({ manpower: { sops: ['SOP-X-1'] } }, 'manpower')).toMatchObject({ sops: ['SOP-X-1'], sumber: 'tersimpan' });
		expect(resolveContext(null, 'zzz').sumber).toBe('kosong');
	});
	it('padanan tab lapangan', () => {
		expect(contextKeyForFieldTab('laporan')).toBe('laporan-harian');
		expect(contextKeyForFieldTab('kirim')).toBeNull();
	});
});
