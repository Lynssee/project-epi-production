import { describe, it, expect } from 'vitest';
import { canDriverMark, effectiveStage } from './sjFieldTransitions';

describe('sjFieldTransitions (SJH-16)', () => {
	it('kategori butuh satpam: berangkat hanya dari lolos_gerbang', () => {
		expect(canDriverMark('dalam_perjalanan', 'dimuat', true)).toBe(false);
		expect(canDriverMark('dalam_perjalanan', 'menunggu_gerbang', true)).toBe(false);
		expect(canDriverMark('dalam_perjalanan', 'lolos_gerbang', true)).toBe(true);
	});
	it('kategori tanpa satpam: berangkat dari tahap sebelum gerbang diizinkan', () => {
		expect(canDriverMark('dalam_perjalanan', 'dimuat', false)).toBe(true);
	});
	it('tiba hanya dari dalam_perjalanan', () => {
		expect(canDriverMark('tiba_lokasi', 'lolos_gerbang', false)).toBe(false);
		expect(canDriverMark('tiba_lokasi', 'dalam_perjalanan', true)).toBe(true);
	});
	it('turunan tahap dari status legacy', () => {
		expect(effectiveStage(null, 'shipped')).toBe('lolos_gerbang');
		expect(effectiveStage(null, 'needs_security_check')).toBe('menunggu_gerbang');
		expect(effectiveStage('dimuat', 'shipped')).toBe('dimuat');
	});
});
