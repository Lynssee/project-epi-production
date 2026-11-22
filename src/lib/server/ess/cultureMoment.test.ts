import { describe, it, expect } from 'vitest';
import { resolveCultureSettings, CULTURE_SETTING_DEFS } from './cultureModel';
import {
  normalizeMomen, normalizeDays, normalizeTimes, isoDow, dueScheduledSlot, popupBehavior, isUrgent, popupMomentEnabled,
  eligibleForMoment, pickByMoment, canShowPopup, isMicroquizEligible, pickMicroquiz, toClientMicroquiz, gradeMicroquiz
} from './cultureMoment';

const ON = resolveCultureSettings([
  { setting_key: 'culture.popup_enabled', setting_value: 'true' },
  { setting_key: 'culture.microquiz_enabled', setting_value: 'true' }
]);
const OFF = resolveCultureSettings([]);
const YMD = '2026-11-19'; // Kamis

const item = (o: any = {}) => ({
  id: 1, isi_pesan: 'Pakai APD.', tipe: 'reminder_sop', aktif: true, target_audiens: 'semua', display_mode: 'popup',
  trigger_moments: ['clock_in'], prioritas: 0, ...o
});
const kuis = (o: any = {}) => item({ pertanyaan_kuis: 'APD wajib?', opsi_kuis: ['Ya', 'Tidak', 'Kadang'], jawaban_benar_idx: 0, penjelasan_kuis: 'Selalu wajib.', ...o });

describe('konstanta & setelan', () => {
  it('tipe baru terdaftar & default popup/microquiz MATI (aman)', () => {
    expect(OFF['culture.popup_enabled']).toBe(false);
    expect(OFF['culture.microquiz_enabled']).toBe(false);
    expect(OFF['culture.popup_timing_default']).toBe('after');
    expect(new Set(CULTURE_SETTING_DEFS.map((d) => d.key)).size).toBe(CULTURE_SETTING_DEFS.length);
  });
  it('popupMomentEnabled: butuh popup_enabled + toggle momen', () => {
    expect(popupMomentEnabled(OFF, 'clock_in')).toBe(false);
    expect(popupMomentEnabled(ON, 'clock_in')).toBe(true);
    expect(popupMomentEnabled(ON, 'break_out')).toBe(false);
  });
});

describe('normalisasi', () => {
  it('momen/hari/jam', () => {
    expect(normalizeMomen('["clock_in","x","clock_in","clock_out"]')).toEqual(['clock_in', 'clock_out']);
    expect(normalizeDays([1, '3', 9, 0, 7])).toEqual([1, 3, 7]);
    expect(normalizeTimes(['8:00', '13:30', '25:00', 'abc', '08:00'])).toEqual(['08:00', '13:30']);
    expect(normalizeMomen(null)).toEqual([]);
  });
  it('isoDow', () => {
    expect(isoDow('2026-11-19')).toBe(4); // Kamis
    expect(isoDow('2026-11-22')).toBe(7); // Minggu
    expect(isoDow('2026-11-23')).toBe(1); // Senin
  });
  it('dueScheduledSlot: jendela 30 menit', () => {
    expect(dueScheduledSlot(['10:00', '13:00'], '10:20')).toBe('10:00');
    expect(dueScheduledSlot(['10:00'], '10:45')).toBeNull();
    expect(dueScheduledSlot(['10:00'], '09:59')).toBeNull();
    expect(dueScheduledSlot(['10:00', '10:15'], '10:20')).toBe('10:15');
  });
  it('popupBehavior: default & clamp', () => {
    expect(popupBehavior(null)).toEqual({ dismissible: true, require_ack: false, auto_close_sec: 0, max_show_per_day: 1, cta_label: 'Paham', theme_tone: 'indigo' });
    const b = popupBehavior('{"auto_close_sec":999,"max_show_per_day":0,"theme_tone":"ROSE","cta_label":" Siap "}');
    expect(b).toMatchObject({ auto_close_sec: 60, max_show_per_day: 1, theme_tone: 'rose', cta_label: 'Siap' });
    expect(popupBehavior('{rusak')).toMatchObject({ theme_tone: 'indigo' });
  });
});

describe('eligibleForMoment / pickByMoment', () => {
  const ctx = (o: any = {}) => ({ ymd: YMD, momen: 'clock_in', audience: 'lapangan', divisi: '', settings: ON, ...o });
  it('banner murni & tanpa trigger_moments tidak ikut popup', () => {
    expect(eligibleForMoment(item({ display_mode: 'banner' }), ctx())).toBe(false);
    expect(eligibleForMoment(item({ display_mode: undefined }), ctx())).toBe(false);
    expect(eligibleForMoment(item({ trigger_moments: [] }), ctx())).toBe(false);
    expect(eligibleForMoment(item({ display_mode: 'both' }), ctx())).toBe(true);
  });
  it('momen, hari aktif, audiens, role, pola kerja', () => {
    expect(eligibleForMoment(item(), ctx({ momen: 'clock_out' }))).toBe(false);
    expect(eligibleForMoment(item({ active_days: [1, 2] }), ctx())).toBe(false);
    expect(eligibleForMoment(item({ active_days: [4] }), ctx())).toBe(true);
    expect(eligibleForMoment(item({ target_audiens: 'admin' }), ctx())).toBe(false);
    expect(eligibleForMoment(item({ target_roles: ['PL'] }), ctx({ role: 'pl' }))).toBe(true);
    expect(eligibleForMoment(item({ target_roles: ['PL'] }), ctx({ role: 'hrd' }))).toBe(false);
    expect(eligibleForMoment(item({ target_pola_kerja: ['office'] }), ctx({ polaKerja: 'project' }))).toBe(false);
  });
  it('timing absen: default setelan "after", per konten bisa "before"', () => {
    expect(eligibleForMoment(item(), ctx({ timing: 'after' }))).toBe(true);
    expect(eligibleForMoment(item(), ctx({ timing: 'before' }))).toBe(false);
    expect(eligibleForMoment(item({ timing_absen: 'before' }), ctx({ timing: 'before' }))).toBe(true);
  });
  it('jam terjadwal wajib di dalam jendela', () => {
    const it2 = item({ trigger_moments: ['scheduled_time'], scheduled_times: ['10:00'] });
    expect(eligibleForMoment(it2, ctx({ momen: 'scheduled_time', hhmm: '10:10' }))).toBe(true);
    expect(eligibleForMoment(it2, ctx({ momen: 'scheduled_time', hhmm: '12:00' }))).toBe(false);
  });
  it('prioritas > rotasi; urgent paling depan; max_show_per_day', () => {
    const a = item({ id: 1, prioritas: 1 });
    const b = item({ id: 2, prioritas: 5 });
    const c = item({ id: 3, prioritas: 5 });
    const u = item({ id: 9, prioritas: 0, urgent_sampai: '2099-01-01T00:00:00Z' });
    const picked = pickByMoment([a, b, c], ctx(), { limit: 5 });
    expect(picked.map((i) => i.id).sort()).toEqual([1, 2, 3]);
    expect(picked[2].id).toBe(1); // prioritas rendah terakhir
    expect(pickByMoment([a, b, u], ctx({ nowMs: Date.now() }), { limit: 1 })[0].id).toBe(9);
    expect(pickByMoment([a], ctx(), { tampilHariIni: { 1: 1 } })).toEqual([]); // max 1/hari
    expect(pickByMoment([a], ctx(), { tampilHariIni: { 1: 0 } })).toHaveLength(1);
  });
  it('deterministik per tanggal & rotasi berganti antar hari', () => {
    const g = [item({ id: 1 }), item({ id: 2 }), item({ id: 3 })];
    const d1 = pickByMoment(g, ctx({ ymd: '2026-11-19' }))[0].id;
    expect(pickByMoment(g, ctx({ ymd: '2026-11-19' }))[0].id).toBe(d1);
    const seen = new Set(['2026-11-19', '2026-11-20', '2026-11-21'].map((y) => pickByMoment(g, ctx({ ymd: y }))[0].id));
    expect(seen.size).toBe(3);
  });
  it('null-safe', () => {
    expect(pickByMoment(null, ctx())).toEqual([]);
    expect(eligibleForMoment(null, ctx())).toBe(false);
    expect(isUrgent({}, 1)).toBe(false);
  });
});

describe('canShowPopup (anti-spam)', () => {
  const now = Date.parse('2026-11-19T03:00:00Z');
  it('batas harian & jeda', () => {
    expect(canShowPopup({ shownToday: 3 }, now, ON)).toBe(false);
    expect(canShowPopup({ shownToday: 1, lastShownAtMs: now - 10 * 60000 }, now, ON)).toBe(false); // jeda 30 mnt
    expect(canShowPopup({ shownToday: 1, lastShownAtMs: now - 31 * 60000 }, now, ON)).toBe(true);
    expect(canShowPopup({}, now, ON)).toBe(true);
    expect(canShowPopup({ shownToday: 9, lastShownAtMs: now }, now, ON, { urgent: true })).toBe(true);
  });
});

describe('microquiz', () => {
  it('eligibility: global, tipe, soal valid, tinjau, sakelar konten', () => {
    expect(isMicroquizEligible(kuis(), OFF)).toBe(false);
    expect(isMicroquizEligible(kuis(), ON)).toBe(true);
    expect(isMicroquizEligible(kuis({ tipe: 'pesan_direktur' }), ON)).toBe(false);
    expect(isMicroquizEligible(kuis({ kuis_reviewed: false }), ON)).toBe(false);
    expect(isMicroquizEligible(kuis({ microquiz_aktif: false }), ON)).toBe(false);
    expect(isMicroquizEligible(item(), ON)).toBe(false); // tanpa soal
    expect(isMicroquizEligible(null, ON)).toBe(false);
  });
  it('pickMicroquiz: belum dijawab > salah jatuh tempo > benar jatuh tempo; kuota harian', () => {
    const a = kuis({ id: 1 });
    const b = kuis({ id: 2 });
    const c = kuis({ id: 3 });
    const hist = [
      { propaganda_id: 1, status_aksi: 'kuis_benar', tanggal: '2026-11-18' }, // benar kemarin → skip (30 hari)
      { propaganda_id: 2, status_aksi: 'kuis_salah', tanggal: '2026-11-15' } // salah 4 hari lalu → jatuh tempo
    ];
    expect(pickMicroquiz([a, b, c], hist, YMD, ON).id).toBe(3); // belum pernah dijawab menang
    expect(pickMicroquiz([a, b], hist, YMD, ON).id).toBe(2);
    expect(pickMicroquiz([a], hist, YMD, ON)).toBeNull();
    expect(pickMicroquiz([b], [{ propaganda_id: 2, status_aksi: 'kuis_salah', tanggal: '2026-11-18' }], YMD, ON)).toBeNull(); // belum 2 hari
    expect(pickMicroquiz([a], [{ propaganda_id: 1, status_aksi: 'kuis_benar', tanggal: '2026-10-01' }], YMD, ON).id).toBe(1); // >30 hari
    expect(pickMicroquiz([c], [{ propaganda_id: 9, status_aksi: 'kuis_benar', tanggal: YMD }], YMD, ON)).toBeNull(); // kuota 1/hari
    expect(pickMicroquiz(null, null, YMD, ON)).toBeNull();
  });
  it('toClientMicroquiz tanpa kunci & tanpa penjelasan', () => {
    const c = toClientMicroquiz(kuis({ sop_document_id: 7 }));
    expect(c).toEqual({ id: 1, pertanyaan: 'APD wajib?', opsi: ['Ya', 'Tidak', 'Kadang'], sop_document_id: 7 });
    expect(JSON.stringify(c)).not.toMatch(/jawaban|penjelasan/);
    expect(toClientMicroquiz(item())).toBeNull();
  });
  it('gradeMicroquiz: retry 1x → kunci dibuka hanya saat final', () => {
    const q = kuis();
    expect(gradeMicroquiz(q, 0, 1, ON)).toMatchObject({ benar: true, status_aksi: 'kuis_benar', kunci_idx: 0, penjelasan: 'Selalu wajib.' });
    expect(gradeMicroquiz(q, 1, 1, ON)).toMatchObject({ benar: false, boleh_ulang: true, status_aksi: null, kunci_idx: null, penjelasan: null });
    expect(gradeMicroquiz(q, 1, 2, ON)).toMatchObject({ benar: false, boleh_ulang: false, status_aksi: 'kuis_salah', kunci_idx: 0 });
    expect(gradeMicroquiz(q, 1, 99, ON).status_aksi).toBe('kuis_salah'); // percobaan dijepit
    expect(gradeMicroquiz(q, 9, 1, ON)).toEqual({ valid: false });
    expect(gradeMicroquiz(item(), 0, 1, ON)).toEqual({ valid: false });
    const noRetry = resolveCultureSettings([{ setting_key: 'culture.microquiz_retry', setting_value: '0' }]);
    expect(gradeMicroquiz(q, 1, 1, noRetry).status_aksi).toBe('kuis_salah');
    const noExp = resolveCultureSettings([{ setting_key: 'culture.microquiz_tampilkan_penjelasan', setting_value: 'false' }]);
    expect(gradeMicroquiz(q, 0, 1, noExp).penjelasan).toBeNull();
  });
});
