// src/lib/utils/kendaliHarian.ts
// Fase 4 (Penajaman KPI & Drilldown Detail Dept) — "Kartu Kendali Harian" Project Leader. MODUL MURNI, tanpa I/O.
// Pola kontrak harian disalin dari erp-epi/src/lib/utils/kpiDrilldown.js (buildDailyBreakdown / fillCalendar):
// project-epi tidak mengimpor kode erp-epi (repo terpisah), jadi diport dengan nama & perilaku sama.
// Tiga kartu: (1) kalender kepatuhan Laporan Harian, (2) umur LPJ kasbon (uang muka) yang belum masuk,
// (3) deviasi progres vs target Kurva S pada minggu berjalan.
// ATURAN: data tidak tersedia = null / [] (bukan 0 palsu). TAMPILAN saja — tidak ada gate, tidak memblokir apa pun.

import { plannedPctAt, scurveGap, type SCurvePoint, type SCurveTone } from './fieldSCurve';

const DAY_MS = 86_400_000;
const WIB_MS = 7 * 3600 * 1000;

const validYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const ymdToMs = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getTime();
const msToYmd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const round1 = (v: number) => Math.round(v * 10) / 10;

export function addDaysYmd(ymd: string, delta: number): string {
	return msToYmd(ymdToMs(ymd) + delta * DAY_MS);
}

/** Selisih hari kalender (b − a). */
export function diffDays(aYmd: string, bYmd: string): number {
	return Math.round((ymdToMs(bYmd) - ymdToMs(aYmd)) / DAY_MS);
}

/** Normalisasi tanggal ke 'YYYY-MM-DD'. Nilai kosong / tak valid → null. */
export function isoDay(v: unknown): string | null {
	if (v == null) return null;
	const m = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
	return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Timestamp (UTC / datetime) → tanggal WIB. Tanggal polos 'YYYY-MM-DD' dipakai apa adanya. */
export function toWibYmdLoose(value: unknown): string | null {
	if (value == null || value === '') return null;
	if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
	const t = new Date(value as string).getTime();
	if (!Number.isFinite(t)) return null;
	return new Date(t + WIB_MS).toISOString().slice(0, 10);
}

// ─── Pola kontrak harian (port kpiDrilldown.js) ────────────────────────────────────────────────

export interface DailyRow {
	date: string;
	count: number;
	nominal: number;
	running_total: number;
}

const num = (v: unknown): number => (v == null || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));

/** Agregasi harian: hanya hari yang ADA data (urut naik), lengkap dengan running_total. */
export function buildDailyBreakdown<T>(
	items: T[] | null | undefined,
	o: { dateOf?: (it: T) => unknown; amountOf?: (it: T) => unknown } = {}
): DailyRow[] {
	const dateOf = o.dateOf || ((it: any) => it?.tanggal);
	const amountOf = o.amountOf || ((it: any) => it?.nominal);
	const byDay = new Map<string, { date: string; count: number; nominal: number }>();
	for (const it of Array.isArray(items) ? items : []) {
		const d = isoDay(dateOf(it));
		if (!d) continue;
		const cur = byDay.get(d) || { date: d, count: 0, nominal: 0 };
		cur.count += 1;
		cur.nominal += num(amountOf(it));
		byDay.set(d, cur);
	}
	let running = 0;
	return [...byDay.values()]
		.sort((a, b) => a.date.localeCompare(b.date))
		.map((r) => {
			running += r.nominal;
			return { ...r, running_total: running };
		});
}

/** Kalender penuh fromYmd..toYmd (hari kosong = nol). Versi rentang dari fillCalendar (yang aslinya per bulan). Maks 120 hari. */
export function fillCalendarRange(
	daily: DailyRow[] | null | undefined,
	fromYmd: string,
	toYmd: string
): Array<{ date: string; count: number; nominal: number; running_total: number }> {
	if (!validYmd(fromYmd) || !validYmd(toYmd) || fromYmd > toYmd) return [];
	const n = Math.min(diffDays(fromYmd, toYmd) + 1, 120);
	const map = new Map((Array.isArray(daily) ? daily : []).map((r) => [r.date, r]));
	const out = [];
	let running = 0;
	for (let i = 0; i < n; i++) {
		const date = addDaysYmd(fromYmd, i);
		const r = map.get(date);
		running = r ? r.running_total : running;
		out.push({ date, count: r?.count || 0, nominal: r?.nominal || 0, running_total: running });
	}
	return out;
}

// ─── Kartu 1: kalender kepatuhan Laporan Harian ────────────────────────────────────────────────

export type CalendarCellStatus = 'reported' | 'missed' | 'off' | 'today_pending' | 'pad';

export interface CalendarCell {
	date: string;
	day: number;
	status: CalendarCellStatus;
	/** Jumlah laporan pada tanggal itu (bisa >1). */
	count: number;
}

export interface ComplianceCalendar {
	/** Baris per minggu (Senin–Minggu); sel 'pad' = di luar rentang. */
	weeks: CalendarCell[][];
	/** Hari wajib lapor yang sudah lewat (hari ini tidak dihitung, hari libur mingguan tidak dihitung). */
	required: number;
	reported: number;
	pct: number | null;
	missedDates: string[];
	/** Hari wajib berturut-turut TERBARU yang terlapor (berhenti di hari bolong pertama dari belakang). */
	currentStreak: number;
	/** Hari wajib bolong berturut-turut TERPANJANG dalam rentang. */
	longestMissRun: number;
	todayReported: boolean;
	fromYmd: string;
	toYmd: string;
}

/**
 * Kalender kepatuhan: hijau = ada laporan, merah = bolong (hari wajib, sudah lewat, tanpa laporan),
 * abu = libur mingguan (kecuali tetap ada laporan), kuning = hari ini belum lapor (belum dihitung bolong).
 * Rentang dimulai dari max(todayYmd − (windowDays − 1), startYmd) sehingga hari sebelum proyek mulai tidak tampil merah.
 */
export function buildComplianceCalendar(p: {
	todayYmd: string;
	windowDays?: number;
	startYmd?: string | null;
	offWeekdays?: number[];
	/** Tanggal (WIB) setiap laporan — boleh duplikat. */
	reportDates: Array<string | null | undefined>;
}): ComplianceCalendar | null {
	if (!validYmd(p.todayYmd)) return null;
	const win = Math.min(Math.max(Math.trunc(Number(p.windowDays)) || 28, 7), 62);
	const off = new Set((Array.isArray(p.offWeekdays) ? p.offWeekdays : [0]).map(Number));
	let from = addDaysYmd(p.todayYmd, -(win - 1));
	if (validYmd(p.startYmd) && p.startYmd > from) from = p.startYmd;
	if (from > p.todayYmd) return null; // proyek belum mulai

	const daily = buildDailyBreakdown(p.reportDates, { dateOf: (d) => d, amountOf: () => 0 });
	const days = fillCalendarRange(daily, from, p.todayYmd);

	const cells: CalendarCell[] = days.map((d) => {
		const isOff = off.has(new Date(`${d.date}T00:00:00Z`).getUTCDay());
		let status: CalendarCellStatus;
		if (d.count > 0) status = 'reported';
		else if (isOff) status = 'off';
		else if (d.date === p.todayYmd) status = 'today_pending';
		else status = 'missed';
		return { date: d.date, day: Number(d.date.slice(8, 10)), status, count: d.count };
	});

	// Hari wajib = bukan libur, bukan hari ini (belum selesai). Hari libur yang tetap ada laporan tidak menaikkan/menurunkan target.
	const requiredCells = cells.filter((c) => c.date !== p.todayYmd && c.status !== 'off' && !(c.status === 'reported' && off.has(new Date(`${c.date}T00:00:00Z`).getUTCDay())));
	const reportedReq = requiredCells.filter((c) => c.status === 'reported').length;
	const missedDates = requiredCells.filter((c) => c.status === 'missed').map((c) => c.date);

	let streak = 0;
	for (let i = requiredCells.length - 1; i >= 0; i--) {
		if (requiredCells[i].status === 'reported') streak++;
		else break;
	}
	let longest = 0;
	let run = 0;
	for (const c of requiredCells) {
		if (c.status === 'missed') {
			run++;
			if (run > longest) longest = run;
		} else run = 0;
	}

	// Susun per minggu, Senin = awal. getUTCDay: 0=Min → indeks 6.
	const weeks: CalendarCell[][] = [];
	let row: CalendarCell[] = [];
	const idx = (ymd: string) => (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7;
	for (let i = 0; i < idx(cells[0].date); i++) row.push({ date: '', day: 0, status: 'pad', count: 0 });
	for (const c of cells) {
		row.push(c);
		if (row.length === 7) {
			weeks.push(row);
			row = [];
		}
	}
	if (row.length) {
		while (row.length < 7) row.push({ date: '', day: 0, status: 'pad', count: 0 });
		weeks.push(row);
	}

	return {
		weeks,
		required: requiredCells.length,
		reported: reportedReq,
		pct: requiredCells.length > 0 ? Math.round((reportedReq / requiredCells.length) * 100) : null,
		missedDates,
		currentStreak: streak,
		longestMissRun: longest,
		todayReported: cells[cells.length - 1].status === 'reported',
		fromYmd: from,
		toYmd: p.todayYmd
	};
}

// ─── Kartu 2: umur LPJ kasbon / uang muka yang belum masuk ─────────────────────────────────────

export interface LpjRowRaw {
	id: number;
	nomor_pengajuan?: string | null;
	tujuan_pengajuan?: string | null;
	tanggal_dicairkan?: string | null;
}

export type LpjLevel = 'ok' | 'warn' | 'bad';

export interface LpjAgingItem {
	id: number;
	label: string;
	subtitle: string;
	cairYmd: string | null;
	/** Hari sejak dana cair; null = tanggal cair tidak tercatat (tidak dituduh telat). */
	ageDays: number | null;
	overdue: boolean;
	level: LpjLevel;
}

export interface LpjAging {
	items: LpjAgingItem[];
	total: number;
	overdue: number;
	oldestDays: number | null;
	level: LpjLevel;
}

/**
 * Umur LPJ per pengajuan yang eksplisit berstatus pertanggungjawaban "belum".
 * Masa tenggang (graceDays) sejak dana cair: di dalam tenggang = kuning bila sudah > setengahnya, lewat = merah.
 * Tanggal cair kosong → tampil tapi tidak dihitung telat (Aturan #3: tidak menuduh retroaktif).
 */
export function buildLpjAging(rows: LpjRowRaw[] | null | undefined, todayYmd: string, graceDays = 7): LpjAging {
	const grace = Number.isFinite(Number(graceDays)) && Number(graceDays) >= 0 ? Number(graceDays) : 7;
	const items: LpjAgingItem[] = [];
	for (const r of Array.isArray(rows) ? rows : []) {
		if (r?.id == null) continue;
		const cair = toWibYmdLoose(r.tanggal_dicairkan);
		const age = cair && validYmd(todayYmd) ? Math.max(0, diffDays(cair, todayYmd)) : null;
		const overdue = age != null && age > grace;
		const level: LpjLevel = overdue ? 'bad' : age != null && age > grace / 2 ? 'warn' : 'ok';
		items.push({
			id: Number(r.id),
			label: String(r.nomor_pengajuan || `PA #${r.id}`),
			subtitle: String(r.tujuan_pengajuan || '').trim(),
			cairYmd: cair,
			ageDays: age,
			overdue,
			level
		});
	}
	items.sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1));
	const overdueCount = items.filter((i) => i.overdue).length;
	const ages = items.map((i) => i.ageDays).filter((a): a is number => a != null);
	const level: LpjLevel = overdueCount > 0 ? 'bad' : items.some((i) => i.level === 'warn') ? 'warn' : 'ok';
	return { items, total: items.length, overdue: overdueCount, oldestDays: ages.length ? Math.max(...ages) : null, level };
}

// ─── Kartu 3: deviasi progres vs target Kurva S minggu berjalan ────────────────────────────────

export interface WeeklyDeviation {
	status: 'ok' | 'na';
	/** Alasan 'na' agar UI bisa menjelaskan apa yang perlu dilengkapi. */
	reason?: 'no_baseline' | 'no_timeline' | 'bad_input';
	weekStart: string;
	weekEnd: string;
	/** Target kumulatif (%) pada akhir pekan lalu / hari ini / akhir minggu ini. */
	plannedStartPct: number | null;
	plannedNowPct: number | null;
	plannedEndPct: number | null;
	actualStartPct: number | null;
	actualNowPct: number | null;
	/** Kenaikan progres yang DIRENCANAKAN minggu ini penuh vs yang SUDAH tercapai minggu ini (poin %). */
	plannedWeekPts: number | null;
	actualWeekPts: number | null;
	/** Realisasi − rencana s.d. hari ini (poin %). Negatif = tertinggal. */
	deltaPts: number | null;
	tone: SCurveTone;
	label: string;
	/** Poin % yang masih harus dikejar agar akhir minggu sesuai rencana (≥ 0). */
	remainingPts: number | null;
	workdaysLeft: number;
	/** Rata-rata poin % per hari kerja tersisa yang dibutuhkan. null bila tidak ada hari kerja tersisa / tak ada yang perlu dikejar. */
	neededPerDayPts: number | null;
}

/** Senin (WIB) dari minggu yang memuat tanggal itu. */
export function weekStartMonday(ymd: string): string {
	const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay(); // 0=Min
	return addDaysYmd(ymd, -((dow + 6) % 7));
}

/** Nilai kumulatif aktual pada tanggal (carry-forward titik terakhir ≤ tanggal; sebelum titik pertama = 0). */
export function actualPctAt(series: Array<{ d: string; p: number }> | null | undefined, ymd: string): number {
	let v = 0;
	for (const pt of Array.isArray(series) ? [...series].sort((a, b) => a.d.localeCompare(b.d)) : []) {
		if (pt?.d && pt.d <= ymd) v = Number(pt.p) || 0;
		else if (pt?.d && pt.d > ymd) break;
	}
	return v;
}

export function buildWeeklyDeviation(p: {
	baseline: SCurvePoint[] | null | undefined;
	/** Deret kumulatif aktual (%), dari actualCumulativeSeries. */
	actual: Array<{ d: string; p: number }> | null | undefined;
	/** true bila proyek punya subtask ber-volume di timeline (tanpa itu progres tak bisa dihitung). */
	hasSubtasks: boolean;
	todayYmd: string;
	offWeekdays?: number[];
	tolerancePct?: number;
}): WeeklyDeviation {
	const empty = (reason: WeeklyDeviation['reason'], ws = '', we = ''): WeeklyDeviation => ({
		status: 'na', reason, weekStart: ws, weekEnd: we, plannedStartPct: null, plannedNowPct: null, plannedEndPct: null,
		actualStartPct: null, actualNowPct: null, plannedWeekPts: null, actualWeekPts: null, deltaPts: null,
		tone: 'na', label: 'Belum ada data', remainingPts: null, workdaysLeft: 0, neededPerDayPts: null
	});
	if (!validYmd(p.todayYmd)) return empty('bad_input');
	const ws = weekStartMonday(p.todayYmd);
	const we = addDaysYmd(ws, 6);
	const base = Array.isArray(p.baseline) ? p.baseline : [];
	if (base.length === 0) return empty('no_baseline', ws, we);
	if (!p.hasSubtasks) return empty('no_timeline', ws, we);

	const prevDay = addDaysYmd(ws, -1);
	const plannedStart = plannedPctAt(base, prevDay);
	const plannedNow = plannedPctAt(base, p.todayYmd);
	const plannedEnd = plannedPctAt(base, we);
	if (plannedStart == null || plannedNow == null || plannedEnd == null) return empty('no_baseline', ws, we);

	const actualStart = actualPctAt(p.actual, prevDay);
	const actualNow = actualPctAt(p.actual, p.todayYmd);
	const gap = scurveGap(base, actualNow, p.todayYmd, Number.isFinite(Number(p.tolerancePct)) ? Number(p.tolerancePct) : 5);

	const off = new Set((Array.isArray(p.offWeekdays) ? p.offWeekdays : [0]).map(Number));
	let workdaysLeft = 0;
	for (let d = p.todayYmd; d <= we; d = addDaysYmd(d, 1)) {
		if (!off.has(new Date(`${d}T00:00:00Z`).getUTCDay())) workdaysLeft++;
	}
	const remaining = Math.max(0, round1(plannedEnd - actualNow));

	return {
		status: 'ok',
		weekStart: ws,
		weekEnd: we,
		plannedStartPct: plannedStart,
		plannedNowPct: plannedNow,
		plannedEndPct: plannedEnd,
		actualStartPct: round1(actualStart),
		actualNowPct: round1(actualNow),
		plannedWeekPts: round1(plannedEnd - plannedStart),
		actualWeekPts: round1(actualNow - actualStart),
		deltaPts: gap.deltaPct,
		tone: gap.tone,
		label: gap.label,
		remainingPts: remaining,
		workdaysLeft,
		neededPerDayPts: remaining > 0 && workdaysLeft > 0 ? round1(remaining / workdaysLeft) : null
	};
}
