// src/lib/utils/timelineDisiplin.test.js
import { describe, it, expect } from 'vitest';
import {
  isSubtaskActive,
  hasValidSchedule,
  hasValidPic,
  deriveSubtaskScheduleWindow,
  evaluateSubtaskForReport,
  evaluateProjectScheduleDiscipline,
  autoDistributePlanVolume
} from './timelineDisiplin.js';

describe('timelineDisiplin.js - Pure Function Evaluator (project-epi)', () => {
  describe('isSubtaskActive', () => {
    it('mengembalikan true bila volume > 0', () => {
      expect(isSubtaskActive({ volume: 105, name: 'Primer Coat' })).toBe(true);
    });

    it('mengembalikan true bila ada plan walau volume 0', () => {
      expect(isSubtaskActive({ volume: 0, daily_plan: { '2026-10-19': 10 } })).toBe(true);
    });

    it('mengembalikan true bila ada actual walau volume 0', () => {
      expect(isSubtaskActive({ volume: 0, daily_actual: { '2026-10-19': 5 } })).toBe(true);
    });

    it('mengembalikan false bila nonaktif', () => {
      expect(isSubtaskActive({ volume: 100, nonaktif: true })).toBe(false);
    });

    it('mengembalikan false bila kosong total tanpa nama', () => {
      expect(isSubtaskActive({})).toBe(false);
      expect(isSubtaskActive(null)).toBe(false);
    });
  });

  describe('hasValidSchedule', () => {
    it('mengembalikan true bila daily_plan memiliki nilai positif', () => {
      expect(hasValidSchedule({
        daily_plan: { '2026-10-20': 50, '2026-10-21': 55 }
      })).toBe(true);
    });

    it('mengembalikan false bila daily_plan kosong {} (kasus di foto user)', () => {
      expect(hasValidSchedule({
        name: 'PRIMER COAT',
        volume: 105,
        daily_plan: {}
      })).toBe(false);
    });

    it('mengembalikan false bila daily_plan semua bernilai 0', () => {
      expect(hasValidSchedule({
        daily_plan: { '2026-10-20': 0, '2026-10-21': 0 }
      })).toBe(false);
    });

    it('mengembalikan true bila ada tanggal mulai dan selesai valid', () => {
      expect(hasValidSchedule({
        start_date: '2026-10-20',
        end_date: '2026-10-25'
      })).toBe(true);
    });

    it('mengembalikan false bila tanggal selesai lebih awal dari tanggal mulai', () => {
      expect(hasValidSchedule({
        start_date: '2026-10-25',
        end_date: '2026-10-20'
      })).toBe(false);
    });
  });

  describe('deriveSubtaskScheduleWindow', () => {
    it('menghitung rentang tanggal dari daily_plan terurut', () => {
      const sub = {
        daily_plan: { '2026-10-25': 20, '2026-10-20': 30, '2026-10-22': 20 }
      };
      const res = deriveSubtaskScheduleWindow(sub);
      expect(res.start_date).toBe('2026-10-20');
      expect(res.end_date).toBe('2026-10-25');
      expect(res.workDaysCount).toBe(3);
    });

    it('mengembalikan null bila daily_plan kosong', () => {
      expect(deriveSubtaskScheduleWindow({ daily_plan: {} })).toEqual({
        start_date: null,
        end_date: null,
        workDaysCount: 0
      });
    });
  });

  describe('hasValidPic', () => {
    it('mengembalikan true untuk nama PIC valid', () => {
      expect(hasValidPic({ pic: 'Ridho Akbar' })).toBe(true);
      expect(hasValidPic({ mandor: 'Pak Asep' })).toBe(true);
      expect(hasValidPic({ pic: { nama: 'Budi Santoso' } })).toBe(true);
    });

    it('mengembalikan false untuk placeholder', () => {
      expect(hasValidPic({ pic: '-' })).toBe(false);
      expect(hasValidPic({ pic: 'PIC...' })).toBe(false);
      expect(hasValidPic({ mandor: 'mandor…' })).toBe(false);
      expect(hasValidPic({ pic: 'none' })).toBe(false);
      expect(hasValidPic({})).toBe(false);
    });
  });

  describe('evaluateSubtaskForReport (G_LAPOR_SUBTASK_SCHEDULE)', () => {
    it('menolak pengisian laporan bila subtask belum dijadwalkan', () => {
      const res = evaluateSubtaskForReport({
        name: 'PRIMER COAT',
        volume: 105,
        daily_plan: {}
      });
      expect(res.allowed).toBe(false);
      expect(res.isScheduled).toBe(false);
      expect(res.message).toContain('belum dijadwalkan di Timeline');
    });

    it('mengizinkan pengisian laporan bila subtask sudah dijadwalkan', () => {
      const res = evaluateSubtaskForReport({
        name: 'PRIMER COAT',
        volume: 105,
        daily_plan: { '2026-10-20': 50, '2026-10-21': 55 }
      });
      expect(res.allowed).toBe(true);
      expect(res.isScheduled).toBe(true);
    });
  });

  describe('evaluateProjectScheduleDiscipline (G_PRJ_KICKOFF_SCHEDULE)', () => {
    it('gagal jika timeline kosong', () => {
      const res = evaluateProjectScheduleDiscipline(null);
      expect(res.passed).toBe(false);
      expect(res.totalActiveSubtasks).toBe(0);
    });

    it('mendeteksi subtask tanpa jadwal dan subtask tanpa PIC', () => {
      const planning = {
        categories: [
          {
            id: 'cat_1',
            name: 'Pengecatan Lantai Epoxy',
            subtasks: [
              { id: 's1', name: 'Primer Coat', volume: 105, daily_plan: {}, pic: '-' },
              { id: 's2', name: 'Body Coat', volume: 105, daily_plan: { '2026-10-20': 50 }, pic: 'Mandor Asep' },
              { id: 's3', name: 'Finish Coat', volume: 105, daily_plan: {}, pic: 'Mandor Asep' }
            ]
          },
          {
            id: 'cat_sys_wajib',
            name: 'Mobilisasi / Demobilisasi (Sistem)',
            subtasks: [
              { id: 'sys1', name: 'Mobilisasi', volume: 1, daily_plan: {} }
            ]
          }
        ]
      };

      const res = evaluateProjectScheduleDiscipline(planning, { excludeSystemCategory: true });
      expect(res.passed).toBe(false);
      expect(res.totalActiveSubtasks).toBe(3); // cat_sys_wajib diabaikan
      expect(res.scheduledCount).toBe(1);
      expect(res.unscheduledCount).toBe(2);
      expect(res.scheduledPct).toBe(33);
      expect(res.unscheduledSubtasks.map((s) => s.subName)).toEqual(['Primer Coat', 'Finish Coat']);
      expect(res.missingPicCount).toBe(1);
      expect(res.missingPics[0].subName).toBe('Primer Coat');
    });

    it('lulus jika semua subtask aktif telah memiliki jadwal', () => {
      const planning = {
        categories: [
          {
            id: 'cat_1',
            name: 'Pengecatan',
            subtasks: [
              { id: 's1', name: 'Primer Coat', volume: 100, daily_plan: { '2026-10-20': 100 }, pic: 'Budi' },
              { id: 's2', name: 'Finish Coat', volume: 100, daily_plan: { '2026-10-21': 100 }, pic: 'Budi' }
            ]
          }
        ]
      };
      const res = evaluateProjectScheduleDiscipline(planning);
      expect(res.passed).toBe(true);
      expect(res.scheduledPct).toBe(100);
      expect(res.unscheduledCount).toBe(0);
    });
  });

  describe('autoDistributePlanVolume (Quick-Scheduler)', () => {
    it('membagi volume rata ke hari kerja aktif dan meletakkan sisa pembulatan di hari terakhir', () => {
      const res = autoDistributePlanVolume(100, '2026-10-19', '2026-10-21');
      expect(res).toEqual({
        '2026-10-19': 33.33,
        '2026-10-20': 33.33,
        '2026-10-21': 33.34
      });
      const sum = Object.values(res).reduce((a, b) => a + b, 0);
      expect(Math.round(sum * 100) / 100).toBe(100);
    });

    it('melewati hari Minggu secara default', () => {
      const res = autoDistributePlanVolume(80, '2026-10-24', '2026-10-26', { skipSunday: true });
      expect(res['2026-10-24']).toBe(40);
      expect(res['2026-10-25']).toBeUndefined();
      expect(res['2026-10-26']).toBe(40);
    });

    it('melewati hari libur nasional jika didaftarkan di holidays', () => {
      const holidays = new Set(['2026-10-20']);
      const res = autoDistributePlanVolume(60, '2026-10-19', '2026-10-21', { holidays });
      expect(res['2026-10-19']).toBe(30);
      expect(res['2026-10-20']).toBeUndefined();
      expect(res['2026-10-21']).toBe(30);
    });
  });
});
