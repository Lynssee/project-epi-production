import { describe, it, expect } from 'vitest';
import { evaluateBerangkat } from './berangkatGuard';

describe('evaluateBerangkat (SJH-15)', () => {
	it('belum dicetak → blocker', () => {
		expect(evaluateBerangkat({ print_count: 0, vehicle_id: 1, security_verified_at: 'x' }, true)[0]).toMatch(/dicetak/);
	});
	it('butuh satpam tapi belum lolos → blocker; kategori tanpa satpam → tidak', () => {
		expect(evaluateBerangkat({ print_count: 1, vehicle_id: 1 }, true)).toEqual(['SJ belum diloloskan satpam di gerbang.']);
		expect(evaluateBerangkat({ print_count: 1, vehicle_id: 1 }, false)).toEqual([]);
	});
	it('approval menunggu & tanpa kendaraan → dua blocker', () => {
		expect(evaluateBerangkat({ print_count: 1, approval_status: 'menunggu' }, false)).toHaveLength(2);
	});
	it('semua terpenuhi → kosong', () => {
		expect(evaluateBerangkat({ print_count: 1, approval_status: 'disetujui', security_verified_at: 't', vehicle_id: 3 }, true)).toEqual([]);
	});
});
