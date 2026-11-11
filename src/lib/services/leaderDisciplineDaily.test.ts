// src/lib/services/leaderDisciplineDaily.test.ts
import { describe, it, expect } from 'vitest';
import {
	computeLeaderDailyDiscipline,
	type RawDisciplineRecords
} from './leaderDisciplineDaily';

describe('computeLeaderDailyDiscipline', () => {
	it('Pagi hari (07:30 WIB): semua checklist masih pending wajar, skor awal netral', () => {
		const raw: RawDisciplineRecords = {
			tbmList: [],
			p2hList: [],
			absensiList: [],
			reportList: [],
			activeEquipmentCount: 2,
			currentTimeWib: { hour: 7, minute: 30 }
		};

		const result = computeLeaderDailyDiscipline(raw, '2026-11-09');
		expect(result.checklist).toHaveLength(4);
		expect(result.checklist.find((c) => c.key === 'tbm')?.status).toBe('pending');
		expect(result.checklist.find((c) => c.key === 'p2h')?.status).toBe('in_progress');
		expect(result.checklist.find((c) => c.key === 'absensi')?.status).toBe('pending');
		expect(result.checklist.find((c) => c.key === 'laporan')?.status).toBe('pending');
		expect(result.alerts).toHaveLength(0); // Belum ada overdue alert di pagi buta
	});

	it('Siang hari (10:00 WIB): TBM belum diisi -> overdue & alert K3 muncul', () => {
		const raw: RawDisciplineRecords = {
			tbmList: [],
			p2hList: [{ id: 1, equipment_id: 'EQ-01', is_go: true }],
			absensiList: [{ id: 1, project_id: 101, status: 'hadir', is_geofence_valid: true }],
			reportList: [],
			activeEquipmentCount: 1,
			currentTimeWib: { hour: 10, minute: 0 }
		};

		const result = computeLeaderDailyDiscipline(raw, '2026-11-09');
		const tbm = result.checklist.find((c) => c.key === 'tbm');
		expect(tbm?.status).toBe('overdue');
		expect(tbm?.score).toBe(20);
		expect(result.alerts.some((a) => a.message.includes('TBM Safety Briefing'))).toBe(true);
	});

	it('P2H: ada unit No-Go -> status warning dan alert work order mekanik muncul', () => {
		const raw: RawDisciplineRecords = {
			tbmList: [{ id: 1, project_id: 101, tanggal: '2026-11-09' }],
			p2hList: [
				{ id: 1, equipment_id: 'EQ-01', is_go: true, status_kondisi: 'baik' },
				{ id: 2, equipment_id: 'EQ-02', is_go: false, status_kondisi: 'rusak', result: 'no_go' }
			],
			absensiList: [{ id: 1, project_id: 101, status: 'hadir', is_geofence_valid: true }],
			reportList: [],
			activeEquipmentCount: 2,
			currentTimeWib: { hour: 11, minute: 0 }
		};

		const result = computeLeaderDailyDiscipline(raw, '2026-11-09');
		const p2h = result.checklist.find((c) => c.key === 'p2h');
		expect(p2h?.status).toBe('warning');
		expect(p2h?.statusLabel).toContain('1 Unit No-Go');
		expect(result.alerts.some((a) => a.message.includes('No-Go'))).toBe(true);
	});

	it('Malam hari (20:30 WIB): Laporan Harian belum terkirim -> overdue dan alert kritis', () => {
		const raw: RawDisciplineRecords = {
			tbmList: [{ id: 1, project_id: 101, tanggal: '2026-11-09' }],
			p2hList: [{ id: 1, equipment_id: 'EQ-01', is_go: true }],
			absensiList: [{ id: 1, project_id: 101, status: 'hadir', is_geofence_valid: true }],
			reportList: [],
			activeEquipmentCount: 1,
			currentTimeWib: { hour: 20, minute: 30 }
		};

		const result = computeLeaderDailyDiscipline(raw, '2026-11-09');
		const lh = result.checklist.find((c) => c.key === 'laporan');
		expect(lh?.status).toBe('overdue');
		expect(lh?.score).toBe(0);
		expect(result.alerts.some((a) => a.message.includes('SLA 20:00 WIB terlewati'))).toBe(true);
	});

	it('Semua checklist tuntas tepat waktu -> skor 100 dan level TELADAN', () => {
		const raw: RawDisciplineRecords = {
			tbmList: [{ id: 1, project_id: 101, tanggal: '2026-11-09' }],
			p2hList: [
				{ id: 1, equipment_id: 'EQ-01', is_go: true },
				{ id: 2, equipment_id: 'EQ-02', is_go: true }
			],
			absensiList: [
				{ id: 1, project_id: 101, status: 'hadir', is_geofence_valid: true, is_late: false },
				{ id: 2, project_id: 101, status: 'hadir', is_geofence_valid: true, is_late: false }
			],
			reportList: [
				{
					id: 50,
					project_id: 101,
					date: '2026-11-09',
					progress_photos: ['foto1.jpg'],
					status: 'submitted',
					is_susulan: false
				}
			],
			activeEquipmentCount: 2,
			currentTimeWib: { hour: 20, minute: 15 }
		};

		const result = computeLeaderDailyDiscipline(raw, '2026-11-09');
		expect(result.score).toBe(100);
		expect(result.level).toBe('TELADAN');
		expect(result.badge.label).toBe('Sangat Tertib');
		expect(result.alerts).toHaveLength(0);
	});

	it('Proyek tanpa alat berat aktif -> P2H menjadi not_applicable', () => {
		const raw: RawDisciplineRecords = {
			tbmList: [{ id: 1, project_id: 101, tanggal: '2026-11-09' }],
			p2hList: [],
			absensiList: [{ id: 1, project_id: 101, status: 'hadir', is_geofence_valid: true }],
			reportList: [],
			activeEquipmentCount: 0,
			currentTimeWib: { hour: 10, minute: 0 }
		};

		const result = computeLeaderDailyDiscipline(raw, '2026-11-09');
		const p2h = result.checklist.find((c) => c.key === 'p2h');
		expect(p2h?.status).toBe('not_applicable');
		expect(p2h?.score).toBe(100);
	});

	it('weeklyStreak: menghitung rasio hari tepat waktu dalam 7 hari terakhir', () => {
		const raw: RawDisciplineRecords = {
			tbmList: [],
			p2hList: [],
			absensiList: [],
			reportList: [],
			weeklyReportList: [
				{ date: '2026-11-03', is_susulan: false },
				{ date: '2026-11-04', is_susulan: false },
				{ date: '2026-11-05', is_susulan: true }, // 1 susulan
				{ date: '2026-11-06', is_susulan: false },
				{ date: '2026-11-07', is_susulan: false }
			],
			activeEquipmentCount: 0,
			currentTimeWib: { hour: 10, minute: 0 }
		};

		const result = computeLeaderDailyDiscipline(raw, '2026-11-09');
		expect(result.weeklyStreak).toBeDefined();
		expect(result.weeklyStreak?.totalDays).toBe(5);
		expect(result.weeklyStreak?.onTimeDays).toBe(4);
		expect(result.weeklyStreak?.streakPct).toBe(80);
	});
});
