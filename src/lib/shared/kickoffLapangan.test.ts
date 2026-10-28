import { describe, it, expect } from 'vitest';
import { canKickoffFrom, failedReadiness, timelineHasContent } from './kickoffLapangan';

describe('kickoffLapangan', () => {
	it('hanya Waiting/Draft yang boleh; on progress = already', () => {
		expect(canKickoffFrom('waiting').can).toBe(true);
		expect(canKickoffFrom('Draft').can).toBe(true);
		expect(canKickoffFrom('on progress')).toMatchObject({ can: false, already: true });
		expect(canKickoffFrom('hold').can).toBe(false);
		expect(canKickoffFrom('closed').can).toBe(false);
		expect(canKickoffFrom(null).can).toBe(false);
	});
	it('failedReadiness mendaftar item kurang', () => {
		expect(failedReadiness({ leaderAssigned: true, charterApproved: true, rabTotal: 5, timelineSet: true })).toEqual([]);
		expect(failedReadiness({ leaderAssigned: true, charterApproved: false, rabTotal: 0, timelineSet: false })).toEqual([
			'Charter disetujui',
			'RAB > 0',
			'Timeline tersusun'
		]);
	});
	it('timelineHasContent defensif', () => {
		expect(timelineHasContent(null)).toBe(false);
		expect(timelineHasContent('{"categories":[]}')).toBe(false);
		expect(timelineHasContent({ categories: [{ id: 1 }] })).toBe(true);
		expect(timelineHasContent('bukan json')).toBe(true);
	});
});
