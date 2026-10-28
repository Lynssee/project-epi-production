import { describe, it, expect } from 'vitest';
import { analyzeWorkHours, durationMinutes, formatDuration, timeSlots, toHHMM } from './charterWorkHours';

describe('charterWorkHours', () => {
  it('menormalkan format waktu', () => {
    expect(toHHMM('8:05')).toBe('08:05');
    expect(toHHMM('08:00:00')).toBe('08:00');
    expect(toHHMM('25:00')).toBe('');
    expect(toHHMM(null)).toBe('');
  });

  it('menghitung durasi biasa dan lewat tengah malam', () => {
    expect(durationMinutes('08:00', '17:00')).toBe(540);
    expect(durationMinutes('19:00', '04:00')).toBe(540);
    expect(durationMinutes('08:00', '')).toBeNull();
  });

  it('slot 15 menit = 96 slot', () => {
    expect(timeSlots(15)).toHaveLength(96);
  });

  it('format durasi', () => {
    expect(formatDuration(540)).toBe('9 jam');
    expect(formatDuration(510)).toBe('8 jam 30 menit');
  });

  it('lembur normal tidak bertabrakan', () => {
    const r = analyzeWorkHours({ mulai: '08:00', selesai: '17:00', lemburOn: true, lemburMulai: '17:00', lemburSelesai: '21:00' });
    expect(r.lemburMin).toBe(240);
    expect(r.totalMin).toBe(780);
    expect(r.warnings).toEqual([]);
  });

  it('lembur mulai sebelum jam normal selesai = peringatan', () => {
    const r = analyzeWorkHours({ mulai: '08:00', selesai: '17:00', lemburOn: true, lemburMulai: '16:00', lemburSelesai: '20:00' });
    expect(r.warnings.some((w) => w.includes('bertabrakan'))).toBe(true);
  });

  it('shift malam + lembur setelah selesai tidak bertabrakan', () => {
    const r = analyzeWorkHours({ mulai: '19:00', selesai: '04:00', lemburOn: true, lemburMulai: '04:00', lemburSelesai: '06:00' });
    expect(r.warnings).toEqual([]);
  });

  it('format tidak valid diberi peringatan', () => {
    const r = analyzeWorkHours({ mulai: 'abc', selesai: '17:00' });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
