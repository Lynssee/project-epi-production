import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  installFetchProfiler, fetchSessions, clearFetchSessions, parseServerTiming, parseQueryShape, labelOf,
  normalizeRoute, analyzeSession, buildReport, setThresholds, DEFAULT_THRESHOLDS
} from './fetchProfiler';

const e = (o: any) => ({ method: 'GET', key: `GET:/api/directus/items/${o.label}`, label: 'x', start: 0, dur: 100, ok: true, status: 200, cache: 'MISS', serverMs: null, appMs: null, bytes: 1024, unboundedLimit: false, wildcardFields: false, ...o });

describe('parser', () => {
  it('parseServerTiming', () => {
    const t = parseServerTiming('directus;dur=185;desc="MISS", app;dur=190.5');
    expect(t.directus).toEqual({ dur: 185, desc: 'MISS' });
    expect(t.app.dur).toBe(190.5);
    expect(parseServerTiming(null)).toEqual({});
  });
  it('parseQueryShape / labelOf / normalizeRoute', () => {
    expect(parseQueryShape('?limit=-1&fields=*&filter[a]=b')).toMatchObject({ unboundedLimit: true, wildcardFields: true });
    expect(parseQueryShape('?fields=id,nama&limit=20')).toMatchObject({ unboundedLimit: false, wildcardFields: false });
    expect(labelOf('/api/directus/items/employees')).toBe('employees');
    expect(labelOf('/api/grand-po/12/cost-detail')).toBe('api/grand-po/12');
    expect(normalizeRoute('/projects/12/edit')).toBe('/projects/:id/edit');
  });
});

describe('analyzeSession', () => {
  it('mendeteksi duplikat/N+1 dalam jendela waktu', () => {
    const entries = [0, 100, 300].map((s, i) => e({ id: i, label: 'employees', key: 'GET:/api/directus/items/employees?limit=5', start: s }));
    const a = analyzeSession({ entries });
    expect(a.duplicates).toHaveLength(1);
    expect(a.duplicates[0]).toMatchObject({ label: 'employees', count: 3 });
    expect(a.findings.some((f) => f.title.includes('3× identik'))).toBe(true);
  });

  it('duplikat di luar jendela 2 dtk tidak dihitung', () => {
    const entries = [0, 3000, 6000].map((s, i) => e({ id: i, label: 'k', key: 'GET:k', start: s }));
    expect(analyzeSession({ entries }).duplicates).toHaveLength(0);
  });

  it('mendeteksi rantai berurutan, bukan fetch paralel', () => {
    const seq = [0, 110, 230, 350].map((s, i) => e({ id: i, label: `c${i}`, key: `GET:c${i}`, start: s, dur: 100 }));
    expect(analyzeSession({ entries: seq }).chain).toMatchObject({ length: 4 });
    const par = [0, 5, 10, 15].map((s, i) => e({ id: i, label: `c${i}`, key: `GET:c${i}`, start: s, dur: 300 }));
    expect(analyzeSession({ entries: par }).chain).toBeNull();
  });

  it('membedakan query berat (server) vs jaringan lambat (server cepat)', () => {
    const heavy = e({ id: 1, label: 'laporan', dur: 900, serverMs: 800, appMs: 820, key: 'GET:a' });
    const net = e({ id: 2, label: 'projects', start: 2000, dur: 1000, serverMs: 120, appMs: 130, key: 'GET:b' });
    const a = analyzeSession({ entries: [heavy, net] });
    expect(a.findings.some((f) => f.level === 'bad' && f.title.includes('"laporan"'))).toBe(true);
    expect(a.findings.some((f) => f.title.includes('Jaringan lambat ke "projects"'))).toBe(true);
    expect(a.findings.some((f) => f.title.includes('Jaringan lambat ke "laporan"'))).toBe(false);
  });

  it('overfetch, error, cache %, dan halaman bersih', () => {
    const a = analyzeSession({ entries: [
      e({ id: 1, label: 'a', cache: 'HIT', unboundedLimit: true, wildcardFields: true }),
      e({ id: 2, label: 'b', start: 500, cache: 'MISS', ok: false, status: 403 })
    ] });
    expect(a.overfetch[0]).toMatchObject({ label: 'a' });
    expect(a.errors).toBe(1);
    expect(a.cacheHitPct).toBe(50);
    expect(analyzeSession({ entries: [e({ id: 1, label: 'ok' })] }).findings[0].level).toBe('ok');
    expect(analyzeSession({ entries: [] }).count).toBe(0);
  });

  it('ambang bisa diatur & laporan tidak memuat nilai filter', () => {
    setThresholds({ slowMs: 50 });
    const s = { route: '/x', entries: [e({ id: 1, label: 'a', dur: 80, search: '?filter[email]=rahasia@x.com' })] };
    expect(analyzeSession(s).slow).toHaveLength(1);
    expect(buildReport(s)).not.toContain('rahasia');
    setThresholds(DEFAULT_THRESHOLDS);
  });
});

describe('installFetchProfiler', () => {
  let originalFetch: any;
  beforeEach(() => {
    clearFetchSessions();
    originalFetch = vi.fn(async () => new Response('{}', {
      status: 200,
      headers: { 'Server-Timing': 'directus;dur=120;desc="MISS", app;dur=125', 'X-Epi-Bytes': '2048' }
    }));
    vi.stubGlobal('window', { fetch: originalFetch, location: { origin: 'http://localhost', pathname: '/projects/7' } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('merekam same-origin /api, mengabaikan pulse & eksternal, mengembalikan respons asli', async () => {
    installFetchProfiler();
    installFetchProfiler(); // idempotent
    const f = window.fetch;
    const res = await f('/api/directus/items/employees?limit=-1&fields=*');
    expect(await res.text()).toBe('{}');
    await f('/api/health/pulse');
    await f('https://cdn.example.com/x.js');
    await f('/static/a.png');
    expect(originalFetch).toHaveBeenCalledTimes(4);

    await new Promise((r) => setTimeout(r, 260)); // notify() di-throttle 200 ms
    let snap: any;
    fetchSessions.subscribe((s: any) => (snap = s))();
    expect(snap).toHaveLength(1);
    expect(snap[0].route).toBe('/projects/:id');
    expect(snap[0].entries).toHaveLength(1);
    expect(snap[0].entries[0]).toMatchObject({ label: 'employees', status: 200, cache: 'MISS', serverMs: 120, appMs: 125, bytes: 2048, unboundedLimit: true, wildcardFields: true });
  });

  it('error jaringan: promise tetap ditolak ke pemanggil, entri ditandai gagal', async () => {
    originalFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    installFetchProfiler();
    await expect(window.fetch('/api/foo')).rejects.toThrow('Failed to fetch');
    await new Promise((r) => setTimeout(r, 10));
    let snap: any;
    fetchSessions.subscribe((s: any) => (snap = s))();
    expect(snap[0].entries[0]).toMatchObject({ ok: false, error: 'TypeError' });
  });

  it('pindah halaman = sesi baru', async () => {
    installFetchProfiler();
    await window.fetch('/api/a');
    window.location.pathname = '/inventory';
    await window.fetch('/api/b');
    let snap: any;
    fetchSessions.subscribe((s: any) => (snap = s))();
    expect(snap.map((s: any) => s.route)).toEqual(['/projects/:id', '/inventory']);
  });
});
