import { describe, it, expect } from 'vitest';
import { computeOwnScore, flaggedFuelIds, normalizeWeights } from './driverScore';

const TODAY = new Date(2026, 10, 19);

describe('driverScore (port dari erp-epi)', () => {
	it('bobot rusak → default', () => {
		expect(normalizeWeights('{bad')).toEqual({ trip: 30, p2h: 30, bbm: 20, sim: 20 });
	});

	it('skor sama dengan versi admin: trip 50, p2h 50, bbm 50, sim expired → 40', () => {
		const r = computeOwnScore(
			{
				trips: [{ status: 'completed' }, { status: 'active' }],
				checksCount: 1,
				fuelInMonth: [{ id: 2 }, { id: 3 }],
				flaggedIds: new Set(['2']),
				simExpiry: '2026-11-01'
			},
			TODAY
		);
		expect(r.score).toBe(40);
		expect(r.band).toBe('rendah');
	});

	it('tanpa aktivitas → skor null', () => {
		const r = computeOwnScore({ trips: [], checksCount: 0, fuelInMonth: [], flaggedIds: new Set(), simExpiry: '2028-01-01' }, TODAY);
		expect(r.score).toBeNull();
		expect(r.band).toBe('none');
	});

	it('flaggedFuelIds: 50 liter / 80 km = boros; odometer mundur ikut ditandai', () => {
		const fuel = [
			{ id: 1, vehicle_id: 1, tanggal: '2026-11-01', liter: 40, odometer: 1000 },
			{ id: 2, vehicle_id: 1, tanggal: '2026-11-05', liter: 50, odometer: 1080 },
			{ id: 3, vehicle_id: 1, tanggal: '2026-11-09', liter: 10, odometer: 900 }
		];
		const f = flaggedFuelIds(fuel, new Map([['1', 10]]), 8, 20);
		expect([...f].sort()).toEqual(['2', '3']);
	});
});
