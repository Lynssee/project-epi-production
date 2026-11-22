import { describe, it, expect, beforeEach } from 'vitest';
import { loadFieldSetRules, resetSetRulesCache } from './plSetFieldLoader';
import { evaluateProductSets, evaluateEquipmentSets } from '$lib/shared/plSet';

beforeEach(() => resetSetRulesCache());

describe('loadFieldSetRules', () => {
	it('tanpa baris setelan ⇒ aturan bawaan (OX-602 → THINER 006, Vakum → belalai)', async () => {
		const r = await loadFieldSetRules(async () => ({ data: [] }));
		expect(evaluateProductSets(r.product, { request: ['CAT OX-602'] }).status).toBe('failed');
		expect(evaluateProductSets(r.product, { request: ['CAT OX-602', 'THINER 006'] }).status).toBe('passed');
		expect(evaluateEquipmentSets(r.equipment, { request: ['VACUM CLEANER 20 LTR'] }).status).toBe('failed');
	});

	it('baris setelan (string JSON) dipakai; [] menonaktifkan semua', async () => {
		const r = await loadFieldSetRules(async () => ({ data: [{ setting_key: 'pkl_set.product_rules', setting_value: '[]' }] }));
		expect(r.product).toEqual([]);
		expect(r.equipment.length).toBeGreaterThan(0); // kunci lain tak ada ⇒ bawaan
	});

	it('gagal baca ⇒ bawaan, tidak melempar', async () => {
		const r = await loadFieldSetRules(async () => { throw new Error('boom'); });
		expect(r.product.length).toBeGreaterThan(0);
	});

	it('cache 5 menit: panggilan kedua tidak query ulang', async () => {
		let n = 0;
		const dx = async () => { n++; return { data: [] }; };
		await loadFieldSetRules(dx);
		await loadFieldSetRules(dx);
		expect(n).toBe(1);
	});
});
