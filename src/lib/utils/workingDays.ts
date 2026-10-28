// Timeline & Scope Management Fase 2 — sumber tunggal kalkulasi hari kerja/libur.
// Logika identik dengan erp-epi-1/src/lib/utils/workingDays.js (duplikasi disengaja,
// konvensi yang sama dipakai timelineDelayFlags.ts / project-alert-check).
// Dipakai di timeline/[project_id]/+page.svelte menggantikan hardcode
// dayOfWeek === 0 || dayOfWeek === 6 yang sebelumnya tidak sinkron dengan admin.

export interface HolidayRow {
	date?: string;
	is_active?: boolean;
}

/** Kunci tanggal lokal YYYY-MM-DD (bukan toISOString — hindari pergeseran timezone). */
export function formatDateKey(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

/**
 * Apakah `date` bukan hari kerja berdasarkan pola mingguan (tanpa memperhitungkan hari libur).
 * 5 -> Sabtu(6) & Minggu(0) libur. 6 -> Minggu(0) saja libur. 7 -> tidak ada yang libur.
 */
export function isNonWorkday(date: Date, workdaysPerWeek: number): boolean {
	const day = date.getDay();
	if (workdaysPerWeek >= 7) return false;
	if (workdaysPerWeek <= 5) return day === 0 || day === 6;
	return day === 0; // 6 hari/minggu
}

/** Set tanggal (YYYY-MM-DD) dari baris koleksi `holidays` (hanya yang is_active). */
export function buildHolidaySet(holidayRows: HolidayRow[] | null | undefined): Set<string> {
	const set = new Set<string>();
	for (const row of holidayRows || []) {
		if (row?.is_active === false) continue;
		if (row?.date) set.add(String(row.date).slice(0, 10));
	}
	return set;
}

/** `project.workdays_per_week ?? globalDefault`. */
export function getEffectiveWorkdaysPerWeek(
	project: { workdays_per_week?: number | null } | null | undefined,
	globalDefault: number
): number {
	const override = project?.workdays_per_week;
	return override != null ? Number(override) : Number(globalDefault);
}

/** Gabungan: apakah `date` adalah hari libur default (weekend pola mingguan ATAU tanggal di holidaySet). */
export function isDefaultNonWorkday(date: Date, workdaysPerWeek: number, holidaySet: Set<string>): boolean {
	if (isNonWorkday(date, workdaysPerWeek)) return true;
	return holidaySet.has(formatDateKey(date));
}

/**
 * Jumlah hari kerja (inklusif kedua ujung) antara `start` dan `end` (Date atau string YYYY-MM-DD).
 * Skip weekend (sesuai workdaysPerWeek) & tanggal di holidaySet. Fase 3 — dasar durasi critical path.
 */
export function countWorkingDays(
	start: Date | string,
	end: Date | string,
	workdaysPerWeek: number,
	holidaySet: Set<string>
): number {
	const startDate = start instanceof Date ? start : new Date(start);
	const endDate = end instanceof Date ? end : new Date(end);
	if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || endDate < startDate) return 0;
	let count = 0;
	const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
	const last = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
	while (cursor <= last) {
		if (!isDefaultNonWorkday(cursor, workdaysPerWeek, holidaySet)) count++;
		cursor.setDate(cursor.getDate() + 1);
	}
	return count;
}

const HARI_WAJIB_DEFAULT = [1, 2, 3, 4, 5, 6];

function shiftDay(ymd: string, delta: number): string {
	if (!ymd) return '';
	const [y, m, d] = ymd.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

function dowOf(ymd: string): number {
	return new Date(ymd + 'T00:00:00Z').getUTCDay();
}

/** Cari hari kerja terakhir sebelum ymd (default: Senin-Sabtu hari wajib proyek) */
export function getPreviousWorkday(ymd: string, hariWajib: number[] = HARI_WAJIB_DEFAULT): string {
	if (!ymd) return '';
	for (let i = 1; i <= 7; i++) {
		const d = shiftDay(ymd, -i);
		if (hariWajib.includes(dowOf(d))) return d;
	}
	return shiftDay(ymd, -1);
}

/** Cari hari kerja pertama setelah ymd (hari briefing yang mengevaluasi laporan ymd) */
export function getNextWorkday(ymd: string, hariWajib: number[] = HARI_WAJIB_DEFAULT): string {
	if (!ymd) return '';
	for (let i = 1; i <= 7; i++) {
		const d = shiftDay(ymd, i);
		if (hariWajib.includes(dowOf(d))) return d;
	}
	return shiftDay(ymd, 1);
}
