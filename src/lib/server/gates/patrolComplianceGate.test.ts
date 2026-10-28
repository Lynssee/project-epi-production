import { describe, expect, it } from 'vitest';
import { computePatrolScore, evaluatePatrolComplianceGate } from './patrolComplianceGate';

describe('computePatrolScore', () => {
	it('semua titik rute ter-scan → 100', () => {
		const r = computePatrolScore({ routeCheckpointIds: [1, 2, 3], scannedCheckpointIds: [3, 2, 1] });
		expect(r).toMatchObject({ skor: 100, total: 3, scannedInRoute: 3, missingIds: [] });
	});
	it('sebagian ter-scan dibulatkan, titik hilang dilaporkan', () => {
		const r = computePatrolScore({ routeCheckpointIds: [1, 2, 3], scannedCheckpointIds: [1] });
		expect(r.skor).toBe(33);
		expect(r.missingIds).toEqual([2, 3]);
	});
	it('scan di luar rute dan duplikat tidak menambah skor', () => {
		const r = computePatrolScore({ routeCheckpointIds: [1, 2], scannedCheckpointIds: [1, 1, 9] });
		expect(r.skor).toBe(50);
	});
	it('id string dan number dianggap sama', () => {
		expect(computePatrolScore({ routeCheckpointIds: ['1', 2], scannedCheckpointIds: [1, '2'] }).skor).toBe(100);
	});
	it('tanpa rute: ada scan → 100, tanpa scan → 0', () => {
		expect(computePatrolScore({ routeCheckpointIds: [], scannedCheckpointIds: [5] }).skor).toBe(100);
		expect(computePatrolScore({ routeCheckpointIds: null, scannedCheckpointIds: [] }).skor).toBe(0);
	});
	it('input null aman', () => {
		expect(computePatrolScore({ routeCheckpointIds: undefined, scannedCheckpointIds: undefined }).skor).toBe(0);
	});
});

describe('evaluatePatrolComplianceGate (G_SEC5)', () => {
	it('skor ≥ ambang → lolos', () => {
		expect(evaluatePatrolComplianceGate({ skor: 70, total: 10, scannedInRoute: 7, threshold: 70 }).passed).toBe(true);
	});
	it('skor < ambang → gagal dengan rincian', () => {
		const r = evaluatePatrolComplianceGate({ skor: 50, total: 4, scannedInRoute: 2, threshold: 70 });
		expect(r.passed).toBe(false);
		expect(r.summary).toContain('2 dari 4');
		expect(r.summary).toContain('70%');
	});
	it('ambang 0 → tidak dievaluasi', () => {
		expect(evaluatePatrolComplianceGate({ skor: 0, total: 3, scannedInRoute: 0, threshold: 0 }).passed).toBe(true);
	});
});
