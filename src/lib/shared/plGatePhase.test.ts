import { describe, it, expect } from 'vitest';
import { gatePhase, leaderNoticeText } from './plGatePhase';

const now = new Date('2026-11-10T10:00:00');

describe('gatePhase (lapangan)', () => {
	it('hard + tanggal di depan -> masa tenggang dengan sisa hari', () => {
		expect(gatePhase({ terdaftar: true, aktif: true, mode: 'hard', enforceFrom: '2026-11-17' }, now)).toMatchObject({ phase: 'masa_tenggang', daysLeft: 7, tone: 'amber' });
	});
	it('hard + tanggal hari ini/lewat atau kosong -> berlaku', () => {
		expect(gatePhase({ terdaftar: true, aktif: true, mode: 'hard', enforceFrom: '2026-11-10' }, now).phase).toBe('berlaku');
		expect(gatePhase({ terdaftar: true, aktif: true, mode: 'hard' }, now).phase).toBe('berlaku');
	});
	it('soft/shadow -> pantau; nonaktif/belum terdaftar -> tanpa banner', () => {
		expect(gatePhase({ terdaftar: true, aktif: true, mode: 'soft' }, now).phase).toBe('pantau');
		expect(gatePhase({ terdaftar: true, aktif: false, mode: 'hard' }, now).phase).toBe('nonaktif');
		expect(gatePhase(null, now).phase).toBe('belum_terdaftar');
	});
});

describe('leaderNoticeText', () => {
	it('masa tenggang menyebut tanggal dan sisa hari; berlaku menyebut TIDAK BISA', () => {
		const t = leaderNoticeText({ phase: 'masa_tenggang', daysLeft: 7, tone: 'amber' }, '2026-11-17');
		expect(t).toContain('2026-11-17');
		expect(t).toContain('7 hari lagi');
		expect(leaderNoticeText({ phase: 'berlaku', daysLeft: 0, tone: 'red' })).toContain('TIDAK BISA');
	});
	it('pantau/nonaktif -> null', () => {
		expect(leaderNoticeText({ phase: 'pantau', daysLeft: null, tone: 'blue' })).toBeNull();
		expect(leaderNoticeText({ phase: 'nonaktif', daysLeft: null, tone: 'none' })).toBeNull();
	});
});
