// src/lib/utils/dossierReadiness.ts
// Visibilitas Leader Fase 3 — Kesiapan Dokumentasi Lapangan (bahan Master Dossier / BAST), murni tanpa I/O.
// BEDA dari gauge "Kesiapan Master Dossier" admin (Grand PO): rumus admin memakai proksi (mis. Log Harian dianggap
// siap bila ada proyek / progres > 0), sedangkan di sini SETIAP indikator dihitung dari data nyata di Directus.
// Hanya TAMPILAN: tidak memblokir apa pun (Aturan #3/#6/#11 tidak terpicu). Ambang & jendela dari setelan project.field_dossier.*.

export type ReadinessLevel = 'ok' | 'warn' | 'bad' | 'na';
export type ReadinessActionKey = 'presensi' | 'log_harian' | 'qc' | 'surat_jalan' | 'lpj' | 'dokumen';

export interface ReadinessItem {
	id: ReadinessActionKey;
	label: string;
	icon: string;
	/** 0–100; null = tidak berlaku / belum terukur (tidak ikut rata-rata). */
	pct: number | null;
	level: ReadinessLevel;
	detail: string;
	actionLabel: string;
	/** Tanggal (YYYY-MM-DD) yang belum terpenuhi — untuk tooltip / pelacakan. */
	missingDays?: string[];
}

export interface ReadinessThresholds {
	okPct: number;
	warnPct: number;
}

export const DEFAULT_THRESHOLDS: ReadinessThresholds = { okPct: 90, warnPct: 60 };

const DAY_MS = 86_400_000;
const ymdToMs = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getTime();
const msToYmd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const validYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Hari kerja yang wajib punya data: `windowDays` hari kalender TERAKHIR sebelum hari ini (hari ini tidak dihitung
 * karena belum selesai), tanpa hari libur mingguan (`offWeekdays`, 0 = Minggu) dan tidak lebih awal dari `startYmd`.
 */
export function requiredDays(p: { todayYmd: string; windowDays: number; offWeekdays?: number[]; startYmd?: string | null }): string[] {
	if (!validYmd(p.todayYmd)) return [];
	const win = Math.min(Math.max(Math.trunc(Number(p.windowDays)) || 7, 1), 31);
	const off = new Set((Array.isArray(p.offWeekdays) ? p.offWeekdays : [0]).map(Number));
	const today = ymdToMs(p.todayYmd);
	const start = validYmd(p.startYmd) ? ymdToMs(p.startYmd) : -Infinity;
	const out: string[] = [];
	for (let i = win; i >= 1; i--) {
		const ms = today - i * DAY_MS;
		if (ms < start) continue;
		if (off.has(new Date(ms).getUTCDay())) continue;
		out.push(msToYmd(ms));
	}
	return out;
}

export function coverage(days: string[], have: Iterable<string>): { done: number; total: number; pct: number | null; missing: string[] } {
	const set = new Set(have);
	const missing = (days || []).filter((d) => !set.has(d));
	const total = (days || []).length;
	const done = total - missing.length;
	return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : null, missing };
}

export function levelFor(pct: number | null, t: ReadinessThresholds = DEFAULT_THRESHOLDS): ReadinessLevel {
	if (pct == null || !Number.isFinite(pct)) return 'na';
	if (pct >= t.okPct) return 'ok';
	if (pct >= t.warnPct) return 'warn';
	return 'bad';
}

export interface ReadinessInput {
	days: string[];
	/** Presensi: tanggal yang punya minimal satu baris; null = proyek tak punya tim terdaftar (tidak berlaku). */
	absensiDates: string[] | null;
	/** true = sumber presensi gagal dimuat (BUKAN "tak ada tim"): indikator ditandai tak terukur, tidak dianggap lengkap. */
	absensiUnavailable?: boolean;
	/** Jumlah presensi yang masih menunggu verifikasi leader. */
	absensiMenunggu: number;
	/** Tanggal yang punya laporan harian; null = sumber gagal dimuat. */
	reportDates: string[] | null;
	/**
	 * QC Ambient harian (suhu baja, titik embun, RH) pada hari kerja pengecatan/blasting yang ada progres:
	 * `qcRequiredDays` = hari yang wajib (laporan qc_ambient.applicable, ada progres, bukan Hold), `qcDoneDays` = yang terisi.
	 * null = sumber laporan gagal dimuat.
	 */
	qcRequiredDays?: string[] | null;
	qcDoneDays?: string[] | null;
	/**
	 * LPJ/SPJ dana uang muka proyek: `belum` = pengajuan yang eksplisit berstatus pertanggungjawaban "belum", `overdue` = yang
	 * sudah lewat masa tenggang sejak dana cair. Pengajuan lama tanpa status (sebelum fitur SPJ) TIDAK dihitung (Aturan #3).
	 * null = sumber gagal dimuat.
	 */
	lpj?: { belum: number; overdue: number; firstId?: number | null } | null;
	/** Surat Jalan menunggu konfirmasi terima (GR) di proyek ini; null = belum dimuat. */
	pendingGr: number | null;
	/** Dokumen wajib: total & yang belum diunggah; total 0/null = tidak ada ketentuan. */
	docsRequired: number | null;
	docsMissing: number | null;
	thresholds?: ReadinessThresholds;
}

export interface ReadinessResult {
	items: ReadinessItem[];
	/** Rata-rata indikator yang terukur; null bila tidak ada satu pun. */
	overallPct: number | null;
	overallLevel: ReadinessLevel;
}

const hariTxt = (n: number) => `${n} hari kerja`;

export function buildDossierReadiness(input: ReadinessInput): ReadinessResult {
	const t = input.thresholds ?? DEFAULT_THRESHOLDS;
	const items: ReadinessItem[] = [];

	// 1. Presensi Tim
	if (input.absensiUnavailable) {
		items.push({ id: 'presensi', label: 'Presensi Tim', icon: '👥', pct: null, level: 'na', detail: 'Data presensi belum dapat dimuat — coba muat ulang.', actionLabel: 'Buka Presensi' });
	} else if (input.absensiDates == null) {
		items.push({ id: 'presensi', label: 'Presensi Tim', icon: '👥', pct: null, level: 'na', detail: 'Belum ada tim terdaftar di proyek ini.', actionLabel: 'Lihat Tim' });
	} else {
		const c = coverage(input.days, input.absensiDates);
		let level = levelFor(c.pct, t);
		const menunggu = Math.max(0, input.absensiMenunggu || 0);
		if (menunggu > 0 && level === 'ok') level = 'warn';
		items.push({
			id: 'presensi',
			label: 'Presensi Tim',
			icon: '👥',
			pct: c.pct,
			level,
			detail:
				c.total === 0
					? 'Belum ada hari kerja yang perlu dicek.'
					: `${c.done}/${hariTxt(c.total)} tercatat presensi` + (menunggu > 0 ? `; ${menunggu} presensi menunggu verifikasi Anda` : ''),
			actionLabel: menunggu > 0 ? 'Verifikasi Presensi' : 'Buka Presensi',
			missingDays: c.missing
		});
	}

	// 2. Log Harian
	if (input.reportDates == null) {
		items.push({ id: 'log_harian', label: 'Log Harian', icon: '📰', pct: null, level: 'na', detail: 'Data laporan harian belum dapat dimuat — coba muat ulang.', actionLabel: 'Isi Laporan Harian' });
	} else {
		const c = coverage(input.days, input.reportDates);
		items.push({
			id: 'log_harian',
			label: 'Log Harian',
			icon: '📰',
			pct: c.pct,
			level: levelFor(c.pct, t),
			detail: c.total === 0 ? 'Belum ada hari kerja yang perlu dicek.' : `${c.done}/${hariTxt(c.total)} ada laporan harian`,
			actionLabel: 'Isi Laporan Harian',
			missingDays: c.missing
		});
	}

	// 3. QC Ambient harian
	if (input.qcRequiredDays == null) {
		items.push({ id: 'qc', label: 'QC Ambient Harian', icon: '🔬', pct: null, level: 'na', detail: 'Data QC harian belum dapat dimuat — coba muat ulang.', actionLabel: 'Isi QC di Laporan' });
	} else {
		const c = coverage(input.qcRequiredDays, input.qcDoneDays ?? []);
		items.push({
			id: 'qc',
			label: 'QC Ambient Harian',
			icon: '🔬',
			pct: c.pct,
			level: levelFor(c.pct, t),
			detail:
				c.total === 0
					? 'Tidak ada hari pengecatan/blasting yang wajib QC ambient pada jendela ini.'
					: `${c.done}/${hariTxt(c.total)} pengecatan/blasting ada pembacaan suhu baja, titik embun & RH`,
			actionLabel: 'Isi QC di Laporan',
			missingDays: c.missing
		});
	}

	// 4. Surat Jalan (GR)
	if (input.pendingGr == null) {
		items.push({ id: 'surat_jalan', label: 'Surat Jalan', icon: '📦', pct: null, level: 'na', detail: 'Status penerimaan barang belum dapat dimuat.', actionLabel: 'Cek Surat Jalan' });
	} else {
		const n = Math.max(0, input.pendingGr);
		items.push({
			id: 'surat_jalan',
			label: 'Surat Jalan',
			icon: '📦',
			pct: n === 0 ? 100 : 0,
			level: n === 0 ? 'ok' : 'bad',
			detail: n === 0 ? 'Semua barang yang dikirim sudah dikonfirmasi diterima.' : `${n} Surat Jalan menunggu konfirmasi diterima (GR)`,
			actionLabel: 'Konfirmasi GR'
		});
	}

	// 5. LPJ / SPJ dana
	if (input.lpj == null) {
		items.push({ id: 'lpj', label: 'Kasbon / LPJ', icon: '🧾', pct: null, level: 'na', detail: 'Status pertanggungjawaban dana belum dapat dimuat.', actionLabel: 'Buka Pengajuan' });
	} else {
		const belum = Math.max(0, input.lpj.belum || 0);
		const overdue = Math.min(belum, Math.max(0, input.lpj.overdue || 0));
		items.push({
			id: 'lpj',
			label: 'Kasbon / LPJ',
			icon: '🧾',
			pct: belum === 0 ? 100 : overdue > 0 ? 0 : 50,
			level: belum === 0 ? 'ok' : overdue > 0 ? 'bad' : 'warn',
			detail:
				belum === 0
					? 'Tidak ada uang muka proyek yang menunggu pertanggungjawaban (nota/LPJ).'
					: `${belum} pengajuan uang muka belum dipertanggungjawabkan` + (overdue > 0 ? ` (${overdue} lewat masa tenggang)` : ''),
			actionLabel: 'Upload LPJ'
		});
	}

	// 6. Dokumen wajib
	if (!input.docsRequired || input.docsRequired <= 0 || input.docsMissing == null) {
		items.push({ id: 'dokumen', label: 'Dokumen Wajib', icon: '🗂️', pct: null, level: 'na', detail: 'Tidak ada ketentuan dokumen wajib untuk proyek ini.', actionLabel: 'Buka Dokumen' });
	} else {
		const missing = Math.min(Math.max(0, input.docsMissing), input.docsRequired);
		const pct = Math.round(((input.docsRequired - missing) / input.docsRequired) * 100);
		items.push({
			id: 'dokumen',
			label: 'Dokumen Wajib',
			icon: '🗂️',
			pct,
			level: levelFor(pct, t),
			detail: missing === 0 ? 'Semua dokumen wajib sudah diunggah.' : `${missing} dari ${input.docsRequired} jenis dokumen wajib belum diunggah`,
			actionLabel: 'Upload Dokumen'
		});
	}

	const measured = items.filter((i) => i.pct != null) as Array<ReadinessItem & { pct: number }>;
	const overallPct = measured.length ? Math.round(measured.reduce((a, i) => a + i.pct, 0) / measured.length) : null;
	return { items, overallPct, overallLevel: levelFor(overallPct, t) };
}
