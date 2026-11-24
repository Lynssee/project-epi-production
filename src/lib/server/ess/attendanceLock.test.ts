import { describe, it, expect } from 'vitest';
import { attendanceLockKey, withAttendanceLock, _activeAttendanceLockCount } from './attendanceLock';

describe('attendanceLock', () => {
	it('coalesces concurrent calls for the same (action, karyawan, tanggal) into 1 execution', async () => {
		const key = attendanceLockKey('clock_in', 42, '2026-11-24');
		let runs = 0;
		let release!: () => void;
		const gate = new Promise<void>((r) => {
			release = r;
		});

		const fn = async () => {
			runs += 1;
			await gate;
			return { id: 'abs-1', runs };
		};

		const p1 = withAttendanceLock(key, fn);
		const p2 = withAttendanceLock(key, fn);
		const p3 = withAttendanceLock(key, fn);

		expect(_activeAttendanceLockCount()).toBe(1);
		release();

		const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
		expect(runs).toBe(1);
		expect(r1).toEqual({ id: 'abs-1', runs: 1 });
		expect(r2).toEqual(r1);
		expect(r3).toEqual(r1);
		expect(_activeAttendanceLockCount()).toBe(0);
	});

	it('allows different keys (users or actions) to execute concurrently', async () => {
		const started: string[] = [];
		let release!: () => void;
		const gate = new Promise<void>((r) => {
			release = r;
		});

		const p1 = withAttendanceLock(attendanceLockKey('clock_in', 1, '2026-11-24'), async () => {
			started.push('u1');
			await gate;
			return 'u1';
		});
		const p2 = withAttendanceLock(attendanceLockKey('clock_in', 2, '2026-11-24'), async () => {
			started.push('u2');
			await gate;
			return 'u2';
		});

		await Promise.resolve();
		expect(started).toEqual(['u1', 'u2']);
		expect(_activeAttendanceLockCount()).toBe(2);

		release();
		expect(await Promise.all([p1, p2])).toEqual(['u1', 'u2']);
		expect(_activeAttendanceLockCount()).toBe(0);
	});

	it('releases lock immediately on failure so subsequent retry executes fresh', async () => {
		const key = attendanceLockKey('clock_out', 99, '2026-11-24');
		let attempt = 0;

		await expect(
			withAttendanceLock(key, async () => {
				attempt += 1;
				throw new Error('directus timeout');
			})
		).rejects.toThrow('directus timeout');

		expect(_activeAttendanceLockCount()).toBe(0);

		const res = await withAttendanceLock(key, async () => {
			attempt += 1;
			return 'ok';
		});
		expect(res).toBe('ok');
		expect(attempt).toBe(2);
		expect(_activeAttendanceLockCount()).toBe(0);
	});
});

