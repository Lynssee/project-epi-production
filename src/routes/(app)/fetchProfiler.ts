// src/routes/(app)/fetchProfiler.ts
// Perekam fetch sisi browser (0 dependency) untuk Dashboard Lapangan -- Fase 2 rencana monitoring fetch.
// Kembar src/routes/fetchProfiler.js di erp-epi.
//
// Membungkus window.fetch SEKALI, hanya mencatat panggilan same-origin ke /api/* (kecuali
// /api/health/pulse = pemantauan diri sendiri). Respons TIDAK pernah di-clone/dibaca dan hasil
// promise asli dikembalikan apa adanya. Data hanya di memori tab (maks 4 sesi halaman x 120 fetch).
// Dibaca oleh FetchWaterfallPanel.svelte (tab di popover ServerQualityIndicator, khusus Super Admin).

export const DEFAULT_THRESHOLDS = {
	slowMs: 500, // fetch >= ini dianggap lambat
	duplicateMin: 3, // fetch identik >= ini dalam duplicateWindowMs = duplikat / N+1
	duplicateWindowMs: 2000,
	chainMin: 3, // >= ini fetch berurutan = indikasi waterfall
	chainGapMs: 150, // jeda maks antar fetch agar dianggap berantai
	networkGapMs: 400, // (total - waktu proxy) >= ini = hambatan jaringan perangkat
	pageWaitWarnMs: 3000 // total waktu tunggu halaman yang patut diperingatkan
};
export type Thresholds = typeof DEFAULT_THRESHOLDS;
const THRESH: Thresholds = { ...DEFAULT_THRESHOLDS };

/** Ubah ambang (mis. dari pulse.config). Nilai tak valid diabaikan. */
export function setThresholds(partial: Partial<Thresholds> = {}): void {
	for (const k of Object.keys(DEFAULT_THRESHOLDS) as (keyof Thresholds)[]) {
		const raw = partial[k];
		const v = Number(raw);
		if (raw != null && Number.isFinite(v) && v > 0) THRESH[k] = Math.round(v);
	}
}
export function getThresholds(): Thresholds {
	return { ...THRESH };
}

export interface FetchEntry {
	id: number;
	method: string;
	path: string;
	search: string;
	key: string;
	label: string;
	start: number;
	dur: number | null;
	status: number | null;
	ok: boolean | null;
	error: string | null;
	cache: string | null;
	serverMs: number | null;
	appMs: number | null;
	bytes: number | null;
	limit: string | null;
	fields: string | null;
	unboundedLimit: boolean;
	wildcardFields: boolean;
}
export interface FetchSession {
	id: number;
	pathname: string;
	route: string;
	t0: number;
	startedAt: number;
	entries: FetchEntry[];
}

const MAX_SESSIONS = 4;
const MAX_ENTRIES = 120;
const IGNORED_PREFIXES = ['/api/health/pulse'];

let sessions: FetchSession[] = [];
let seq = 0;
const listeners = new Set<(s: FetchSession[]) => void>();
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function snapshot(): FetchSession[] {
	return sessions.map((s) => ({ ...s, entries: s.entries.slice() }));
}

function notify(): void {
	if (notifyTimer) return;
	notifyTimer = setTimeout(() => {
		notifyTimer = null;
		const snap = snapshot();
		listeners.forEach((fn) => {
			try {
				fn(snap);
			} catch {
				/* subscriber rusak tak boleh mengganggu fetch */
			}
		});
	}, 200);
}

/** Kontrak store Svelte: `$fetchSessions` memberi array sesi (terbaru di akhir). */
export const fetchSessions = {
	subscribe(run: (s: FetchSession[]) => void) {
		run(snapshot());
		listeners.add(run);
		return () => {
			listeners.delete(run);
		};
	}
};

export function clearFetchSessions(): void {
	sessions = [];
	notify();
}

/** Seragamkan id numerik / uuid pada pathname agar /projects/12 dan /projects/57 satu route. */
export function normalizeRoute(pathname: string | null | undefined): string {
	if (!pathname || typeof pathname !== 'string') return '/';
	return (
		pathname
			.split('/')
			.map((seg) => (/^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg) || /^[0-9a-f]{16,}$/i.test(seg) ? ':id' : seg))
			.join('/') || '/'
	);
}

/** Server-Timing: `directus;dur=185;desc="MISS", app;dur=190` -> { directus:{dur,desc}, app:{dur,desc} } */
export function parseServerTiming(header: string | null | undefined): Record<string, { dur: number | null; desc: string | null }> {
	const out: Record<string, { dur: number | null; desc: string | null }> = {};
	for (const part of String(header || '').split(',')) {
		const [rawName, ...params] = part.trim().split(';');
		const name = rawName?.trim();
		if (!name) continue;
		const m: { dur: number | null; desc: string | null } = { dur: null, desc: null };
		for (const p of params) {
			const [k, ...rest] = p.trim().split('=');
			const v = rest.join('=').replace(/^"|"$/g, '');
			if (k === 'dur') {
				const n = parseFloat(v);
				if (Number.isFinite(n)) m.dur = n;
			} else if (k === 'desc') m.desc = v;
		}
		out[name] = m;
	}
	return out;
}

/** Pola overfetch dari query string (nilai filter sengaja tidak dikembalikan -- bisa memuat email/nama). */
export function parseQueryShape(search: string | null | undefined) {
	const out = { unboundedLimit: false, wildcardFields: false, limit: null as string | null, fields: null as string | null };
	try {
		const sp = new URLSearchParams(String(search || '').replace(/^\?/, ''));
		for (const [k, v] of sp.entries()) {
			if (k === 'limit') {
				out.limit = v;
				if (v === '-1') out.unboundedLimit = true;
			} else if (k === 'fields' || k === 'fields[]') {
				out.fields = out.fields ? `${out.fields},${v}` : v;
				if (v.split(',').some((f) => f.trim() === '*' || f.trim().endsWith('.*'))) out.wildcardFields = true;
			}
		}
	} catch {
		/* abaikan */
	}
	return out;
}

/** /api/directus/items/employees?x -> 'employees'; /api/xyz/abc -> 'api/xyz/abc'. */
export function labelOf(pathname: string): string {
	const p = String(pathname || '');
	const m = p.match(/^\/api\/directus\/(?:items\/)?([^/?]+)/);
	if (m) return m[1];
	return p.replace(/^\//, '').split('/').slice(0, 3).join('/') || '(root)';
}

function sameOriginApiUrl(input: RequestInfo | URL): URL | null {
	try {
		const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request)?.url ?? String(input);
		const u = new URL(raw, window.location.origin);
		if (u.origin !== window.location.origin) return null;
		if (!u.pathname.startsWith('/api/')) return null;
		if (IGNORED_PREFIXES.some((p) => u.pathname.startsWith(p))) return null;
		return u;
	} catch {
		return null;
	}
}

function currentSession(now: number): FetchSession {
	const pathname = window.location.pathname;
	let s = sessions[sessions.length - 1];
	if (!s || s.pathname !== pathname) {
		s = { id: ++seq, pathname, route: normalizeRoute(pathname), t0: now, startedAt: Date.now(), entries: [] };
		sessions.push(s);
		if (sessions.length > MAX_SESSIONS) sessions.shift();
	}
	return s;
}

function begin(input: RequestInfo | URL, init?: RequestInit): { entry: FetchEntry; t0: number } | null {
	try {
		const u = sameOriginApiUrl(input);
		if (!u) return null;
		const method = String(init?.method || (typeof input === 'object' && (input as Request)?.method) || 'GET').toUpperCase();
		const now = performance.now();
		const session = currentSession(now);
		const shape = parseQueryShape(u.search);
		const entry: FetchEntry = {
			id: ++seq,
			method,
			path: u.pathname,
			search: u.search,
			key: `${method}:${u.pathname}${u.search}`,
			label: labelOf(u.pathname),
			start: Math.round(now - session.t0),
			dur: null,
			status: null,
			ok: null,
			error: null,
			cache: null,
			serverMs: null,
			appMs: null,
			bytes: null,
			limit: shape.limit,
			fields: shape.fields,
			unboundedLimit: shape.unboundedLimit,
			wildcardFields: shape.wildcardFields
		};
		session.entries.push(entry);
		if (session.entries.length > MAX_ENTRIES) session.entries.shift();
		return { entry, t0: now };
	} catch {
		return null;
	}
}

function finish(meta: { entry: FetchEntry; t0: number }, res: Response): void {
	try {
		const { entry, t0 } = meta;
		entry.dur = Math.round(performance.now() - t0);
		entry.status = res.status;
		entry.ok = res.ok;
		const st = parseServerTiming(res.headers.get('Server-Timing'));
		if (st.directus) {
			entry.serverMs = st.directus.dur;
			entry.cache = st.directus.desc || null;
		}
		if (st.app) entry.appMs = st.app.dur;
		const bytes = Number(res.headers.get('X-Epi-Bytes') ?? res.headers.get('Content-Length'));
		entry.bytes = Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
		notify();
	} catch {
		/* profiler tidak boleh mengganggu */
	}
}

function fail(meta: { entry: FetchEntry; t0: number }, err: unknown): void {
	try {
		meta.entry.dur = Math.round(performance.now() - meta.t0);
		meta.entry.ok = false;
		meta.entry.error = String((err as Error)?.name || 'Error');
		notify();
	} catch {
		/* abaikan */
	}
}

/** Pasang pembungkus window.fetch (idempotent, aman dipanggil saat SSR). */
export function installFetchProfiler(): void {
	if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
	const current = window.fetch as typeof window.fetch & { __epiProfiled?: boolean };
	if (current.__epiProfiled) return;
	const original = window.fetch;
	const wrapped = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
		const meta = begin(input, init);
		const p = original.call(window, input, init); // native fetch wajib dipanggil dengan this = window
		if (meta) p.then((res) => finish(meta, res), (err) => fail(meta, err));
		return p;
	} as typeof window.fetch & { __epiProfiled?: boolean };
	wrapped.__epiProfiled = true;
	window.fetch = wrapped;
}

// ---------------------------------------------------------------------------
// Analisis (murni, mudah dites)
// ---------------------------------------------------------------------------

export interface Finding {
	level: 'bad' | 'warn' | 'info' | 'ok';
	title: string;
	hint: string;
}

export function analyzeSession(session: { entries: FetchEntry[] } | null | undefined, overrides: Partial<Thresholds> = {}) {
	const T = { ...THRESH, ...overrides };
	const all = session?.entries || [];
	const done = all.filter((e) => e.dur != null).sort((a, b) => a.start - b.start);
	const out = {
		count: done.length,
		pending: all.length - done.length,
		errors: done.filter((e) => e.ok === false).length,
		wallMs: 0,
		sumMs: 0,
		longestMs: 0,
		bytes: 0,
		cache: { HIT: 0, COALESCED: 0, MISS: 0, BYPASS: 0, unknown: 0 } as Record<string, number>,
		cacheHitPct: null as number | null,
		slow: [] as FetchEntry[],
		duplicates: [] as { label: string; count: number; total: number; wastedMs: number }[],
		overfetch: [] as { label: string; unboundedLimit: boolean; wildcardFields: boolean }[],
		chain: null as { length: number; totalMs: number; labels: string[] } | null,
		networkSlow: [] as FetchEntry[],
		findings: [] as Finding[]
	};
	if (!done.length) return out;

	const dur = (e: FetchEntry) => e.dur ?? 0;
	const minStart = done[0].start;
	const maxEnd = Math.max(...done.map((e) => e.start + dur(e)));
	out.wallMs = maxEnd - minStart;
	for (const e of done) {
		out.sumMs += dur(e);
		out.longestMs = Math.max(out.longestMs, dur(e));
		out.bytes += e.bytes || 0;
		out.cache[e.cache && e.cache in out.cache ? e.cache : 'unknown']++;
	}
	const reads = out.cache.HIT + out.cache.COALESCED + out.cache.MISS;
	out.cacheHitPct = reads ? Math.round(((out.cache.HIT + out.cache.COALESCED) / reads) * 100) : null;

	out.slow = done.filter((e) => dur(e) >= T.slowMs);

	// Duplikat / N+1: GET identik >= duplicateMin dalam jendela duplicateWindowMs
	const groups = new Map<string, FetchEntry[]>();
	for (const e of done) {
		if (e.method !== 'GET') continue;
		const g = groups.get(e.key);
		if (g) g.push(e);
		else groups.set(e.key, [e]);
	}
	for (const list of groups.values()) {
		let best = 0;
		for (let i = 0, j = 0; i < list.length; i++) {
			while (list[i].start - list[j].start > T.duplicateWindowMs) j++;
			best = Math.max(best, i - j + 1);
		}
		if (best >= T.duplicateMin) {
			out.duplicates.push({ label: list[0].label, count: best, total: list.length, wastedMs: list.slice(1).reduce((a, e) => a + dur(e), 0) });
		}
	}

	const seen = new Set<string>();
	for (const e of done) {
		if ((e.unboundedLimit || e.wildcardFields) && !seen.has(e.label)) {
			seen.add(e.label);
			out.overfetch.push({ label: e.label, unboundedLimit: e.unboundedLimit, wildcardFields: e.wildcardFields });
		}
	}

	// Rantai berurutan: fetch berikutnya baru mulai setelah sebelumnya selesai (jeda kecil)
	let run: FetchEntry[] = [done[0]];
	let bestRun = run;
	for (let i = 1; i < done.length; i++) {
		const prev = done[i - 1];
		const gap = done[i].start - (prev.start + dur(prev));
		if (gap >= -20 && gap <= T.chainGapMs) run = [...run, done[i]];
		else run = [done[i]];
		if (run.length > bestRun.length) bestRun = run;
	}
	if (bestRun.length >= T.chainMin) {
		const last = bestRun[bestRun.length - 1];
		out.chain = {
			length: bestRun.length,
			totalMs: last.start + dur(last) - bestRun[0].start,
			labels: [...new Set(bestRun.map((e) => e.label))].slice(0, 6)
		};
	}

	out.networkSlow = done.filter((e) => e.appMs != null && dur(e) - e.appMs >= T.networkGapMs);

	// Temuan + saran (urut dari paling mendesak)
	const F = out.findings;
	const heavy = out.slow.filter((e) => e.serverMs != null && e.serverMs >= T.slowMs);
	for (const e of heavy.slice(0, 3)) {
		F.push({ level: 'bad', title: `Query berat di "${e.label}" (server ${Math.round(e.serverMs ?? 0)} ms)`, hint: 'Penyebab di sisi server/database. Batasi fields, kecilkan limit, atau tambahkan filter pada query ini.' });
	}
	for (const e of out.networkSlow.slice(0, 3)) {
		F.push({ level: 'warn', title: `Jaringan lambat ke "${e.label}" (server ${Math.round(e.appMs ?? 0)} ms, total ${e.dur} ms)`, hint: 'Server cepat, hambatan ada di sinyal perangkat. Aktifkan Mode Hemat / periksa koneksi di lokasi ini.' });
	}
	if (out.chain) {
		F.push({ level: 'warn', title: `${out.chain.length} fetch berurutan (total ${out.chain.totalMs} ms): ${out.chain.labels.join(' → ')}`, hint: 'Jika fetch-fetch ini tidak saling bergantung, jalankan bersamaan dengan Promise.all agar waktu tunggu = fetch terlama, bukan jumlahnya.' });
	}
	for (const d of out.duplicates.slice(0, 3)) {
		F.push({ level: 'warn', title: `"${d.label}" dipanggil ${d.count}× identik dalam ${T.duplicateWindowMs / 1000} dtk`, hint: 'Beberapa komponen mengambil data yang sama. Ambil sekali di komponen induk / store bersama lalu bagikan.' });
	}
	for (const o of out.overfetch.slice(0, 3)) {
		const what = [o.unboundedLimit ? 'limit=-1' : null, o.wildcardFields ? 'fields=*' : null].filter(Boolean).join(' & ');
		F.push({ level: 'info', title: `Overfetch di "${o.label}" (${what})`, hint: 'Sebut kolom yang dibutuhkan saja dan beri limit/paginasi, terutama untuk koleksi besar.' });
	}
	if (out.errors) {
		F.push({ level: 'bad', title: `${out.errors} fetch gagal`, hint: 'Cek status di daftar bawah. 403 dari Directus biasanya berarti nama kolom/relasi salah (schema drift), bukan izin akses.' });
	}
	if (out.wallMs >= T.pageWaitWarnMs) {
		F.push({ level: 'warn', title: `Halaman menunggu data ±${(out.wallMs / 1000).toFixed(1)} dtk`, hint: 'Total dari fetch pertama sampai terakhir selesai. Kurangi jumlah fetch atau paralelkan.' });
	}
	if (!F.length) F.push({ level: 'ok', title: 'Tidak ada anomali fetch di halaman ini', hint: 'Buka halaman lain atau muat ulang data untuk membandingkan.' });
	return out;
}

/** Ringkasan teks untuk disalin ke developer (tanpa nilai filter). */
export function buildReport(session: { route?: string; entries: FetchEntry[] } | null | undefined, analysis?: ReturnType<typeof analyzeSession>): string {
	const a = analysis || analyzeSession(session);
	const lines = [
		`[EPI FETCH] ${session?.route || '-'} | ${a.count} fetch | tunggu ±${a.wallMs}ms | terlama ${a.longestMs}ms | cache ${a.cacheHitPct ?? '-'}% | ${Math.round(a.bytes / 1024)}KB`,
		...a.findings.map((f) => `- [${f.level}] ${f.title}`)
	];
	const top = (session?.entries || []).filter((e) => e.dur != null).sort((x, y) => (y.dur ?? 0) - (x.dur ?? 0)).slice(0, 8);
	for (const e of top) {
		const q = [e.limit != null ? `limit=${e.limit}` : null, e.fields ? `fields=${e.fields.slice(0, 40)}` : null].filter(Boolean).join('&');
		lines.push(`  ${e.method} ${e.label}${q ? `?${q}` : ''} ${e.dur}ms${e.serverMs != null ? ` (srv ${Math.round(e.serverMs)})` : ''} ${e.cache || ''} ${e.status ?? ''}`.trimEnd());
	}
	return lines.join('\n');
}
