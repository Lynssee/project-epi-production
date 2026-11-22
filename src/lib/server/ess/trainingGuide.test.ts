import { describe, it, expect } from 'vitest';
import { normalizeFieldSteps, DEFAULT_FIELD_STEPS } from './trainingGuide';

describe('normalizeFieldSteps', () => {
	it('kosong/rusak → default', () => {
		expect(normalizeFieldSteps(null)).toEqual(DEFAULT_FIELD_STEPS);
		expect(normalizeFieldSteps('{rusak')).toEqual(DEFAULT_FIELD_STEPS);
		expect(normalizeFieldSteps({ field_steps: ['', '  '] })).toEqual(DEFAULT_FIELD_STEPS);
	});
	it('JSON string, trim, dan batas 8 langkah', () => {
		expect(normalizeFieldSteps(JSON.stringify({ field_steps: [' A ', 'B'] }))).toEqual(['A', 'B']);
		expect(normalizeFieldSteps({ field_steps: Array.from({ length: 12 }, (_, i) => `L${i}`) })).toHaveLength(8);
	});
});
