import { describe, it, expect } from 'vitest';
import { decideStatusAfterLoad as d } from './sjMuatRule';

describe('decideStatusAfterLoad (SJH-01 opsi A)', () => {
	it('created + butuh satpam → needs_security_check/menunggu_security', () => {
		expect(d('created', true)).toEqual({ status: 'needs_security_check', draft_status: 'menunggu_security' });
	});
	it('created + tak butuh satpam → shipped/siap_kirim', () => {
		expect(d('created', false)).toEqual({ status: 'shipped', draft_status: 'siap_kirim' });
	});
	it('status lain tidak disentuh (idempoten, saklar OFF, SJ lama)', () => {
		for (const st of ['needs_security_check', 'shipped', 'delivered', 'pending', null, undefined]) {
			expect(d(st as any, true)).toBeNull();
		}
	});
});
