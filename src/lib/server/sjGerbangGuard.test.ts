import { describe, it, expect } from 'vitest';
import { evaluateGerbangMinimum } from './sjGerbangGuard';

describe('evaluateGerbangMinimum (SJH-12)', () => {
	it('print_count 0/null → BELUM_DICETAK', () => {
		expect(evaluateGerbangMinimum({ nomor_sj: 'SJ/1', print_count: 0, approval_status: 'tidak_perlu' }).map((b) => b.code)).toEqual(['BELUM_DICETAK']);
		expect(evaluateGerbangMinimum({ print_count: null })[0].code).toBe('BELUM_DICETAK');
	});
	it('sudah dicetak + disetujui/tidak_perlu/kosong → lolos', () => {
		expect(evaluateGerbangMinimum({ print_count: 1, approval_status: 'disetujui' })).toEqual([]);
		expect(evaluateGerbangMinimum({ print_count: 2, approval_status: null })).toEqual([]);
	});
	it('approval menunggu → BELUM_DISETUJUI', () => {
		expect(evaluateGerbangMinimum({ print_count: 1, approval_status: 'menunggu' }).map((b) => b.code)).toEqual(['BELUM_DISETUJUI']);
	});
});
