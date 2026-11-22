import { describe, it, expect } from 'vitest';
import { summarizeSpkDataHealth } from './dataHealth';

describe('summarizeSpkDataHealth', () => {
	it('menghitung SPK belum-QC dan tanpa deadline, dengan contoh terbatas', () => {
		const r = summarizeSpkDataHealth(
			[
				{ id: 1, nomor: 'SPK-A', quality_status: null },
				{ id: 2, nomor: 'SPK-B', quality_status: '  ' },
				{ id: 3, nomor: 'SPK-C', quality_status: 'passed' }
			],
			[
				{ id: 4, nomor: 'SPK-D', production_deadline: null },
				{ id: 5, production_deadline: '2026-11-20' },
				{ id: 6, nomor: 'SPK-F', production_deadline: '' }
			],
			{ contoh: 1 }
		);
		expect(r.belumQc).toEqual({ total: 2, contoh: ['SPK-A'] });
		expect(r.tanpaDeadline).toEqual({ total: 2, contoh: ['SPK-D'] });
	});
	it('null/undefined aman, bukan crash', () => {
		const r = summarizeSpkDataHealth(null, undefined);
		expect(r.belumQc.total).toBe(0);
		expect(r.tanpaDeadline.contoh).toEqual([]);
		expect(r.windowHari).toBe(30);
	});
	it('SPK tanpa nomor memakai id sebagai label', () => {
		expect(summarizeSpkDataHealth([{ id: 9 }], []).belumQc.contoh).toEqual(['SPK-9']);
	});
});
