import { describe, it, expect } from 'vitest';
import { adviseSlowEntry, slowEntryToText, sortRows, latencyTone } from './serverProfile';

describe('adviseSlowEntry', () => {
  it('overfetch -> saran paginasi & fields, severity warn', () => {
    const a = adviseSlowEntry({ method: 'GET', durMs: 700, unboundedLimit: true, wildcardFields: true, bytes: 2048 }, { slowMs: 500 });
    expect(a.flags).toEqual(['limit=-1', 'fields=*']);
    expect(a.steps.some((s) => s.includes('paginasi'))).toBe(true);
    expect(a.steps.some((s) => s.includes('fields=id'))).toBe(true);
    expect(a.severity).toBe('warn');
  });

  it('≥ 3× ambang = bad dan ada saran prioritas', () => {
    const a = adviseSlowEntry({ method: 'GET', durMs: 1800, bytes: 10 }, { slowMs: 500 });
    expect(a.severity).toBe('bad');
    expect(a.steps.some((s) => s.includes('prioritaskan'))).toBe(true);
  });

  it('payload besar & 403 mengarah ke schema drift, bukan izin', () => {
    const a = adviseSlowEntry({ method: 'GET', durMs: 600, status: 403, bytes: 900 * 1024 });
    expect(a.flags).toContain('900 KB');
    expect(a.steps.join(' ')).toContain('audit-field-contract');
  });

  it('tulis lambat diarahkan ke guard/hook, tanpa saran filter bacaan', () => {
    const a = adviseSlowEntry({ method: 'PATCH', durMs: 900 });
    expect(a.steps[0]).toContain('Penulisan lambat');
  });

  it('query lambat tanpa pola overfetch tetap diberi saran umum', () => {
    expect(adviseSlowEntry({ method: 'GET', durMs: 520 }).steps[0]).toContain('index');
  });

  it('tahan input kosong', () => {
    expect(() => adviseSlowEntry(null)).not.toThrow();
    expect(() => slowEntryToText(undefined)).not.toThrow();
  });
});

describe('slowEntryToText', () => {
  it('memuat halaman, durasi, rekomendasi bernomor — tanpa nilai filter', () => {
    const t = slowEntryToText({
      method: 'GET', path: 'items/laporan', route: '/laporan/:id', durMs: 900, cache: 'MISS', status: 200, bytes: 4096,
      limit: '-1', fields: '*', params: ['filter[email][_eq]'], unboundedLimit: true, wildcardFields: true
    });
    expect(t).toContain('/laporan/:id');
    expect(t).toContain('900 ms');
    expect(t).toContain('1. ');
    expect(t).toContain('filter[email][_eq]=…');
    expect(t).not.toContain('@');
  });
});

describe('sortRows & latencyTone', () => {
  it('urut menurun menurut kunci, null = 0', () => {
    const rows = [{ n: 'a', avgMs: null }, { n: 'b', avgMs: 300 }, { n: 'c', avgMs: 900 }];
    expect(sortRows(rows, 'avgMs').map((r) => r.n)).toEqual(['c', 'b', 'a']);
    expect(sortRows(undefined)).toEqual([]);
  });
  it('warna menurut ambang', () => {
    expect(latencyTone(1200, 500)).toContain('rose');
    expect(latencyTone(600, 500)).toContain('amber');
    expect(latencyTone(100, 500)).toContain('slate');
    expect(latencyTone(null)).toContain('slate-400');
  });
});
