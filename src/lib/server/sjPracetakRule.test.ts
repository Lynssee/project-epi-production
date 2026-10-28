import { describe, it, expect } from 'vitest';
import { decidePracetakAction as d } from './sjPracetakRule';

describe('decidePracetakAction (SJH-07 §4.3, salinan erp-epi)', () => {
	it('belum dicetak & belum ditandatangani → write', () => {
		expect(d({ print_count: 0, pracetak_gudang: null })).toEqual({ action: 'write' });
	});
	it('sudah ditandatangani sebelum cetak → already (tidak ditimpa)', () => {
		const existing = { by_name: 'Budi', at: '2026-10-06T01:00:00Z' };
		expect(d({ print_count: 0, pracetak_gudang: existing })).toEqual({ action: 'already', existing });
	});
	it('sudah dicetak tanpa izin cetak ulang → reject 409', () => {
		expect(d({ print_count: 1 })).toMatchObject({ action: 'reject', status: 409 });
	});
	it('izin cetak ulang disetujui → write; dibatalkan → reject', () => {
		expect(d({ print_count: 1, reprint_status: 'disetujui' })).toEqual({ action: 'write' });
		expect(d({ status: 'cancelled' }).action).toBe('reject');
	});
});
