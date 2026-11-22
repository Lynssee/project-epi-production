import { describe, it, expect } from 'vitest';
import { nowHm, needsDurationConfirm, formatDurasi } from './woLaporGuard';

describe('woLaporGuard', () => {
	it('nowHm = HH:MM dengan nol di depan', () => {
		expect(nowHm(new Date(2026, 10, 17, 7, 5))).toBe('07:05');
		expect(nowHm(new Date(2026, 10, 17, 14, 30))).toBe('14:30');
	});

	it('konfirmasi hanya saat progres 100% tanpa durasi dan belum dikonfirmasi', () => {
		expect(needsDurationConfirm({ progress: 100, durasiKerjaMenit: null, alreadyConfirmed: false })).toBe(true);
		expect(needsDurationConfirm({ progress: 100, durasiKerjaMenit: 0, alreadyConfirmed: false })).toBe(true);
		expect(needsDurationConfirm({ progress: 100, durasiKerjaMenit: null, alreadyConfirmed: true })).toBe(false);
		expect(needsDurationConfirm({ progress: 100, durasiKerjaMenit: 90, alreadyConfirmed: false })).toBe(false);
		expect(needsDurationConfirm({ progress: 60, durasiKerjaMenit: null, alreadyConfirmed: false })).toBe(false);
	});

	it('formatDurasi', () => {
		expect(formatDurasi(45)).toBe('45 menit');
		expect(formatDurasi(95)).toBe('1 jam 35 menit');
	});
});
