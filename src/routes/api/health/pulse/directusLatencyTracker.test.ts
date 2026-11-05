import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordDirectusRequest, getDirectusProfile, resetDirectusProfile, getDirectusLatencyStats,
  classifyCache, collectionOf, parseQueryShape, normalizeRoute, configureProfiler
} from './directusLatencyTracker';

describe('directusLatencyTracker — profil fetch', () => {
  beforeEach(() => {
    resetDirectusProfile();
    configureProfiler({ slowMs: 500, cacheHitMaxMs: 15 });
  });

  it('collectionOf mengambil koleksi dari items/<koleksi>[/id]', () => {
    expect(collectionOf('items/employees')).toBe('employees');
    expect(collectionOf('items/employees/12')).toBe('employees');
    expect(collectionOf('files')).toBe('files');
    expect(collectionOf('')).toBe('(root)');
  });

  it('parseQueryShape mendeteksi limit=-1 & fields=* tanpa menyimpan nilai filter', () => {
    const s = parseQueryShape('?limit=-1&fields=*&filter[email][_eq]=rahasia@x.com');
    expect(s.unboundedLimit).toBe(true);
    expect(s.wildcardFields).toBe(true);
    expect(s.params).toEqual(['filter[email][_eq]']);
    expect(JSON.stringify(s)).not.toContain('rahasia');
    expect(parseQueryShape('?fields=id,nama&limit=50').wildcardFields).toBe(false);
    expect(parseQueryShape('?fields=id,items.*').wildcardFields).toBe(true);
    expect(parseQueryShape(undefined).unboundedLimit).toBe(false);
  });

  it('normalizeRoute menyatukan id numerik/uuid', () => {
    expect(normalizeRoute('/projects/12/edit')).toBe('/projects/:id/edit');
    expect(normalizeRoute('/x/3f2c1a9e-1111-2222-3333-444455556666')).toBe('/x/:id');
    expect(normalizeRoute(null)).toBe('(tanpa referer)');
  });

  it('classifyCache: GET cepat = HIT, GET lambat = MISS, tulis/no-cache = BYPASS', () => {
    expect(classifyCache('GET', 2)).toBe('HIT');
    expect(classifyCache('GET', 180)).toBe('MISS');
    expect(classifyCache('PATCH', 2)).toBe('BYPASS');
    expect(classifyCache('GET', 2, true)).toBe('BYPASS');
  });

  it('cache HIT tidak mengotori EMA & rata-rata upstream', () => {
    recordDirectusRequest({ method: 'GET', path: 'items/employees', durMs: 200, status: 200, cache: 'MISS' });
    const ema = getDirectusLatencyStats().emaMs;
    for (let i = 0; i < 20; i++) recordDirectusRequest({ method: 'GET', path: 'items/employees', durMs: 1, status: 200, cache: 'HIT' });
    expect(getDirectusLatencyStats().emaMs).toBe(ema);

    const p = getDirectusProfile();
    expect(p.totals).toMatchObject({ calls: 21, hit: 20, miss: 1 });
    expect(p.totals.cacheHitPct).toBe(95);
    const c = p.collections.find((x) => x.name === 'employees');
    expect(c.avgMs).toBe(200);
    expect(c.calls).toBe(21);
  });

  it('log lambat hanya untuk upstream >= ambang, terbaru di depan, dengan flag overfetch', () => {
    recordDirectusRequest({ method: 'GET', path: 'items/a', search: '?limit=10', referer: '/x', durMs: 100, status: 200, cache: 'MISS' });
    recordDirectusRequest({ method: 'GET', path: 'items/b', search: '?limit=-1&fields=*', referer: '/laporan/5', durMs: 900, status: 200, bytes: 2048, cache: 'MISS' });
    recordDirectusRequest({ method: 'GET', path: 'items/c', durMs: 700, status: 200, cache: 'MISS' });
    recordDirectusRequest({ method: 'GET', path: 'items/d', durMs: 5000, status: 200, cache: 'HIT' });
    const p = getDirectusProfile();
    expect(p.slow.map((s) => s.collection)).toEqual(['c', 'b']);
    expect(p.slow[1]).toMatchObject({ route: '/laporan/:id', unboundedLimit: true, wildcardFields: true, bytes: 2048 });
    expect(p.routes.find((r) => r.name === '/laporan/:id').unboundedLimit).toBe(1);
  });

  it('configureProfiler mengabaikan nilai tak valid', () => {
    configureProfiler({ slowMs: -5, cacheHitMaxMs: 'abc' });
    expect(getDirectusProfile().config).toMatchObject({ slowMs: 500, cacheHitMaxMs: 15 });
    configureProfiler({ slowMs: 800 });
    expect(getDirectusProfile().config.slowMs).toBe(800);
  });

  it('ring buffer dibatasi 200 dan jumlah koleksi dibatasi', () => {
    for (let i = 0; i < 260; i++) recordDirectusRequest({ method: 'GET', path: `items/k${i}`, durMs: 600, status: 200, cache: 'MISS' });
    const p = getDirectusProfile({ topN: 1000, slowLimit: 1000 });
    expect(p.slow.length).toBe(200);
    expect(p.collections.length).toBeLessThanOrEqual(150);
  });

  it('tidak pernah melempar pada input rusak', () => {
    expect(() => recordDirectusRequest({ path: undefined, durMs: NaN })).not.toThrow();
    expect(() => recordDirectusRequest(null as any)).not.toThrow();
  });
});
