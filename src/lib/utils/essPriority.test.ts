import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	isAttendancePriorityRoute,
	beginAttendancePriority,
	markAttendanceReady,
	isAttendancePriorityPending,
	waitForAttendancePriority,
	_resetAttendancePriorityForTest
} from './essPriority';

describe('essPriority coordinator', () => {
	beforeEach(() => {
		_resetAttendancePriorityForTest();
	});

	it('identifies /ess and /ess/absen as attendance priority routes only', () => {
		expect(isAttendancePriorityRoute('/ess')).toBe(true);
		expect(isAttendancePriorityRoute('/ess/')).toBe(true);
		expect(isAttendancePriorityRoute('/ess/absen')).toBe(true);
		expect(isAttendancePriorityRoute('/ess/absen/detail')).toBe(true);
		expect(isAttendancePriorityRoute('/ess/cuti')).toBe(false);
		expect(isAttendancePriorityRoute('/proyek')).toBe(false);
		expect(isAttendancePriorityRoute('/')).toBe(false);
	});

	it('resolves immediately when priority is not pending', async () => {
		expect(isAttendancePriorityPending()).toBe(false);
		await expect(waitForAttendancePriority(5000)).resolves.toBeUndefined();
	});

	it('waits until markAttendanceReady() releases all waiters', async () => {
		beginAttendancePriority();
		expect(isAttendancePriorityPending()).toBe(true);

		let done1 = false;
		let done2 = false;
		const p1 = waitForAttendancePriority(5000).then(() => {
			done1 = true;
		});
		const p2 = waitForAttendancePriority(5000).then(() => {
			done2 = true;
		});

		await Promise.resolve();
		expect(done1).toBe(false);
		expect(done2).toBe(false);

		markAttendanceReady();
		await Promise.all([p1, p2]);
		expect(done1).toBe(true);
		expect(done2).toBe(true);
		expect(isAttendancePriorityPending()).toBe(false);
	});

	it('falls back after timeoutMs if markAttendanceReady is never called', async () => {
		vi.useFakeTimers();
		beginAttendancePriority();
		let done = false;
		const p = waitForAttendancePriority(300).then(() => {
			done = true;
		});
		await vi.advanceTimersByTimeAsync(250);
		expect(done).toBe(false);
		await vi.advanceTimersByTimeAsync(60);
		await p;
		expect(done).toBe(true);
		vi.useRealTimers();
	});
});

