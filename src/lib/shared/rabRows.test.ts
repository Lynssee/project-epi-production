import { describe, it, expect } from 'vitest';
import { buildRabRows } from './rabRows';

describe('buildRabRows (PRJ-24)', () => {
	const rab = [
		{ id: 1, budget_category: 'supplier', material_name: 'Cat Epoxy', planned_amount: 10_000_000 },
		{ id: 2, budget_category: 'consumable', description: 'Kuas', planned_amount: 1_000_000 },
		{ id: 3, budget_category: 'packing_supplier', material_name: 'PL', planned_amount: 999 },
		{ id: 4, budget_category: 'jasa', planned_amount: 5, is_category_header: true }
	];
	it('terpakai/sisa per baris; packing & header dikeluarkan; overrun di urutan atas', () => {
		const r = buildRabRows(rab, { '1': 6_000_000, '2': 1_500_000 }, 400_000);
		expect(r.rows.map((x) => x.id)).toEqual([2, 1]);
		expect(r.rows[0]).toMatchObject({ over: true, sisa: -500_000 });
		expect(r.rows[1]).toMatchObject({ over: false, sisa: 4_000_000, label: 'Cat Epoxy' });
		expect(r.rows[1].pct).toBeCloseTo(60);
		expect(r.linkedActual).toBe(7_500_000);
		expect(r.unlinkedActual).toBe(400_000);
	});
	it('tanpa tautan sama sekali -> semua terpakai 0', () => {
		const r = buildRabRows(rab, {}, 123);
		expect(r.rows.every((x) => x.terpakai === 0)).toBe(true);
		expect(r.unlinkedActual).toBe(123);
	});
});
