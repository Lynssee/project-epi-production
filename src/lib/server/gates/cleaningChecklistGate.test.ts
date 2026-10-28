import { describe, expect, it } from 'vitest';
import { evaluateCleaningChecklistGate } from './cleaningChecklistGate';

const defs = [
	{ id: 1, item_name: 'Lantai' },
	{ id: 2, item_name: 'Kaca' },
	{ id: 3, item_name: 'Toilet', is_critical: true }
];
const both = { fotoWajibItemNo: true, wajibSemuaItem: true };

describe('evaluateCleaningChecklistGate (G_CLN2)', () => {
	it('lengkap dan semua yes → lolos', () => {
		const r = evaluateCleaningChecklistGate({
			answers: [{ item_id: 1, answer: 'yes' }, { item_id: 2, answer: 'yes' }, { item_id: 3, answer: 'na' }],
			itemDefs: defs, photoCountByItem: {}, options: both
		});
		expect(r.passed).toBe(true);
		expect(r.violations).toEqual([]);
	});

	it('item "no" tanpa foto → melanggar', () => {
		const r = evaluateCleaningChecklistGate({
			answers: [{ item_id: 1, answer: 'yes' }, { item_id: 2, answer: 'no' }, { item_id: 3, answer: 'yes' }],
			itemDefs: defs, photoCountByItem: {}, options: both
		});
		expect(r.passed).toBe(false);
		expect(r.violations[0]).toMatchObject({ code: 'ITEM_NO_TANPA_FOTO', itemIds: [2] });
	});

	it('item "no" dengan foto → lolos', () => {
		const r = evaluateCleaningChecklistGate({
			answers: [{ item_id: 1, answer: 'yes' }, { item_id: 2, answer: 'no' }, { item_id: 3, answer: 'yes' }],
			itemDefs: defs, photoCountByItem: { 2: 1 }, options: both
		});
		expect(r.passed).toBe(true);
	});

	it('item terlewat → melanggar bila wajibSemuaItem aktif', () => {
		const r = evaluateCleaningChecklistGate({
			answers: [{ item_id: 1, answer: 'yes' }], itemDefs: defs, photoCountByItem: {}, options: both
		});
		expect(r.violations.map((v) => v.code)).toEqual(['ITEM_BELUM_DIJAWAB']);
		expect(r.violations[0].itemIds).toEqual([2, 3]);
	});

	it('opsi dimatikan → aturan itu tidak dievaluasi', () => {
		const r = evaluateCleaningChecklistGate({
			answers: [{ item_id: 2, answer: 'no' }], itemDefs: defs, photoCountByItem: {},
			options: { fotoWajibItemNo: false, wajibSemuaItem: false }
		});
		expect(r.passed).toBe(true);
	});

	it('template tanpa item / data null → fail-open', () => {
		expect(evaluateCleaningChecklistGate({ answers: null, itemDefs: [], photoCountByItem: null, options: both }).passed).toBe(true);
		expect(evaluateCleaningChecklistGate({ answers: undefined, itemDefs: undefined, photoCountByItem: undefined, options: both }).passed).toBe(true);
	});

	it('banyak pelanggaran dua-duanya dilaporkan, nama item dipotong 3', () => {
		const many = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, item_name: `I${i + 1}` }));
		const r = evaluateCleaningChecklistGate({ answers: [], itemDefs: many, photoCountByItem: {}, options: both });
		expect(r.violations[0].message).toContain('5 item belum dijawab');
		expect(r.violations[0].message).toContain('…');
	});
});
