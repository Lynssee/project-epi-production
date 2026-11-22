import { describe, it, expect } from 'vitest';
import { computeFlowKnowledge, readStatusOf, statusOfScore } from './sopKnowledgeMine';

describe('sopKnowledgeMine', () => {
	it('status baca sadar versi', () => {
		expect(readStatusOf(2, null, false)).toBe('belum');
		expect(readStatusOf(2, 1, true)).toBe('versi_lama');
		expect(readStatusOf(2, 2, true)).toBe('sudah');
		expect(readStatusOf(2, null, true)).toBe('sudah');
	});
	it('rumus 70/30 sama dengan sisi admin', () => {
		expect(computeFlowKnowledge({ read: 'sudah', hasQuiz: true, bestQuiz: 80 }).score).toBeCloseTo(86);
		expect(computeFlowKnowledge({ read: 'versi_lama', hasQuiz: true, bestQuiz: 100 }).score).toBeCloseTo(70);
		expect(computeFlowKnowledge({ read: 'belum', hasQuiz: true, bestQuiz: null }).status).toBe('remedial');
	});
	it('tanpa kuis: belum diuji (bawaan) atau nilai baca (read_only_cap)', () => {
		expect(computeFlowKnowledge({ read: 'sudah', hasQuiz: false, bestQuiz: null })).toMatchObject({ score: null, status: 'belum_diuji' });
		expect(computeFlowKnowledge({ read: 'sudah', hasQuiz: false, bestQuiz: null, settings: { untestedPolicy: 'read_only_cap' } }).score).toBe(100);
	});
	it('bobot rusak jatuh ke 70/30; ambang status', () => {
		expect(computeFlowKnowledge({ read: 'belum', hasQuiz: true, bestQuiz: 100, settings: { quizWeight: 0, readWeight: 0 } }).score).toBeCloseTo(70);
		expect(statusOfScore(60, 75)).toBe('penguatan');
	});
});
