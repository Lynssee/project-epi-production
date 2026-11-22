import { describe, it, expect } from 'vitest';
import { decidePopup, recordShown, recordAnswered, emptyDayState, loadDayState, saveDayState, loadCachedPayload, saveCachedPayload } from './culturePopupClient';

const memStore = () => { const m = new Map<string, string>(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) }; };
const S = (o: any = {}) => ({ 'culture.popup_enabled': true, 'culture.popup_momen_clock_in': true, 'culture.popup_momen_scheduled_time': true, 'culture.popup_momen_app_open': true, 'culture.popup_min_gap_menit': 30, 'culture.popup_max_per_hari': 3, 'culture.popup_timing_default': 'after', 'culture.popup_rotasi': 'prioritas_lalu_rotasi', ...o });
const it1 = (o: any = {}) => ({ id: 1, judul: 'A', isi_pesan: 'x', tipe: 'reminder_sop', target_audiens: 'semua', aktif: true, display_mode: 'popup', trigger_moments: ['clock_in'], popup_behavior: { max_show_per_day: 1 }, prioritas: 0, microquiz: null, ...o });
const P = (items: any[], settings: any = S()) => ({ enabled: true, ymd: '2026-11-19', settings, items });
const NOW = Date.parse('2026-11-19T01:00:00Z');
const base: any = { momen: 'clock_in', timing: 'after', hhmm: '08:00', nowMs: NOW, ymd: '2026-11-19' };

describe('decidePopup', () => {
  it('tampil di momen yang cocok; mati bila setelan/payload tidak aktif', () => {
    expect(decidePopup(P([it1()]), null, base)?.item.id).toBe(1);
    expect(decidePopup(P([it1()], S({ 'culture.popup_enabled': false })), null, base)).toBeNull();
    expect(decidePopup(P([it1()], S({ 'culture.popup_momen_clock_in': false })), null, base)).toBeNull();
    expect(decidePopup({ enabled: false, items: [] }, null, base)).toBeNull();
    expect(decidePopup(null, null, base)).toBeNull();
    expect(decidePopup(P([it1()]), null, { ...base, momen: 'clock_out' })).toBeNull();
  });
  it('max_show_per_day per konten & jeda antar popup & batas harian', () => {
    const st1 = recordShown(emptyDayState(), 1, NOW);
    expect(decidePopup(P([it1()]), st1, base)).toBeNull(); // sudah 1x, max 1
    const two = [it1({ id: 1 }), it1({ id: 2 })];
    expect(decidePopup(P(two), st1, { ...base, nowMs: NOW + 10 * 60000 })).toBeNull(); // jeda 30 menit
    expect(decidePopup(P(two), st1, { ...base, nowMs: NOW + 31 * 60000 })?.item.id).toBe(2);
    expect(decidePopup(P(two), { ...emptyDayState(), shownToday: 3 }, base)).toBeNull(); // batas harian
  });
  it('darurat melewati jeda & batas harian', () => {
    const urgent = it1({ id: 5, urgent_sampai: '2099-01-01T00:00:00Z', popup_behavior: { max_show_per_day: 5 } });
    expect(decidePopup(P([urgent]), { ...emptyDayState(), shownToday: 9, lastShownAtMs: NOW }, base)?.item.id).toBe(5);
  });
  it('jam terjadwal: sekali per slot', () => {
    const sch = it1({ trigger_moments: ['scheduled_time'], scheduled_times: ['10:00'], popup_behavior: { max_show_per_day: 5 } });
    const ctx: any = { ...base, momen: 'scheduled_time', hhmm: '10:10' };
    const d = decidePopup(P([sch]), null, ctx);
    expect(d?.slot).toBe('10:00');
    const st = recordShown(emptyDayState(), 1, NOW, d.slot);
    expect(decidePopup(P([sch]), st, { ...ctx, nowMs: NOW + 60 * 60000 })).toBeNull();
    expect(decidePopup(P([sch]), null, { ...ctx, hhmm: '12:00' })).toBeNull(); // di luar jendela
  });
  it('microquiz hanya bila ada & belum dijawab', () => {
    const mq = { id: 1, pertanyaan: 'Q', opsi: ['a', 'b', 'c'] };
    expect(decidePopup(P([it1({ microquiz: mq })]), null, base).microquiz).toEqual(mq);
    expect(decidePopup(P([it1({ microquiz: mq })]), recordAnswered(emptyDayState(), 1), base).microquiz).toBeNull();
    expect(decidePopup(P([it1()]), null, base).microquiz).toBeNull();
  });
});

describe('penyimpanan harian', () => {
  it('state & payload hanya berlaku di hari yang sama; storage rusak aman', () => {
    const st = memStore();
    saveDayState(st, 'u1', '2026-11-19', recordShown(emptyDayState(), 7, NOW));
    expect(loadDayState(st, 'u1', '2026-11-19').perItem[7]).toBe(1);
    expect(loadDayState(st, 'u1', '2026-11-20')).toEqual(emptyDayState());
    st.setItem('culturePopup:state:u2', '{rusak');
    expect(loadDayState(st, 'u2', '2026-11-19')).toEqual(emptyDayState());
    expect(loadDayState(null, 'u1', '2026-11-19')).toEqual(emptyDayState());
    saveCachedPayload(st, 'u1', '2026-11-19', { enabled: true, items: [] });
    expect(loadCachedPayload(st, 'u1', '2026-11-19')).toEqual({ enabled: true, items: [] });
    expect(loadCachedPayload(st, 'u1', '2026-11-20')).toBeNull();
    const thrower: any = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
    expect(() => saveDayState(thrower, 'u', 'y', {})).not.toThrow();
    expect(loadCachedPayload(thrower, 'u', 'y')).toBeNull();
  });
});
