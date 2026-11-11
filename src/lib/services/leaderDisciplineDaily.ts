// src/lib/services/leaderDisciplineDaily.ts
// Service & Engine Evaluasi Kepatuhan & Kedisiplinan Harian Lapangan (Fase 4).
// Menghitung status kepatuhan harian Project Leader & tim site (TBM, P2H, Presensi, LH)
// dengan SLA waktu nyata WIB, fail-soft Directus fetching terpisah per relasi,
// dan in-memory cache 60 detik agar hemat API.

import directus, { handleDirectusError } from './directus';
import { readItems } from '@directus/sdk';
import { todayWib } from '$lib/utils/wibDate';

export interface DailyDisciplineChecklistItem {
	key: 'tbm' | 'p2h' | 'absensi' | 'laporan';
	title: string;
	slaTime: string;
	status: 'completed' | 'in_progress' | 'pending' | 'warning' | 'overdue' | 'not_applicable';
	statusLabel: string;
	detail: string;
	actionLabel: string;
	actionUrl: string;
	score: number; // 0 - 100
	weight: number; // decimal e.g. 0.20
}

export interface LeaderDailyDisciplineSummary {
	date: string;
	score: number; // 0 - 100
	level: 'TELADAN' | 'BAIK' | 'PERHATIAN' | 'KRITIS';
	badge: {
		label: string;
		badgeClass: string;
		bg: string;
		text: string;
		border: string;
		summary: string;
	};
	checklist: DailyDisciplineChecklistItem[];
	alerts: Array<{
		priority: 'high' | 'medium' | 'info';
		message: string;
		actionUrl?: string;
		icon: string;
	}>;
	weeklyStreak?: {
		onTimeDays: number;
		totalDays: number;
		streakPct: number;
	};
}

export interface RawDisciplineRecords {
	tbmList: Array<{ id: number; project_id: number; tanggal: string; status?: string; peserta_manpower_ids?: any }>;
	p2hList: Array<{ id: string | number; equipment_id: string; is_go?: boolean; status_kondisi?: string; result?: string }>;
	absensiList: Array<{ id: number; project_id: number; status?: string; is_late?: boolean; is_geofence_valid?: boolean; jarak_meter?: number }>;
	reportList: Array<{ id: number; project_id: number; date: string; date_created?: string; status?: string; progress_photos?: any; area_kerja_photos?: any; attendance_photos?: any; is_susulan?: boolean }>;
	weeklyReportList?: Array<{ date: string; is_susulan?: boolean; date_created?: string }>;
	activeEquipmentCount: number;
	currentTimeWib?: { hour: number; minute: number };
	primaryProjectId?: number;
}

/** Hitung jam & menit saat ini dalam zona waktu WIB */
export function getCurrentWibTime(now = Date.now()): { hour: number; minute: number } {
	const d = new Date(now + 7 * 60 * 60 * 1000);
	return { hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

/** Pure Function untuk mengevaluasi disiplin harian site */
export function computeLeaderDailyDiscipline(
	records: RawDisciplineRecords,
	date = todayWib()
): LeaderDailyDisciplineSummary {
	const curTime = records.currentTimeWib || getCurrentWibTime();
	const timeMinutes = curTime.hour * 60 + curTime.minute;
	const primaryPid = records.primaryProjectId;
	const reportActionUrl = primaryPid ? `/laporan/${primaryPid}` : '/laporan';

	const checklist: DailyDisciplineChecklistItem[] = [];
	const alerts: LeaderDailyDisciplineSummary['alerts'] = [];

	// 1. TBM Morning Briefing (Target 08:00 WIB, Bobot 20%)
	const tbmCount = records.tbmList.length;
	let tbmScore = 0;
	let tbmStatus: DailyDisciplineChecklistItem['status'] = 'pending';
	let tbmLabel = 'Belum Diisi';
	let tbmDetail = 'Briefing K3, APD & bahaya kerja pagi wajib sebelum pekerjaan site dimulai.';

	if (tbmCount > 0) {
		tbmScore = 100;
		tbmStatus = 'completed';
		tbmLabel = 'Selesai';
		tbmDetail = `${tbmCount} sesi TBM briefing tercatat hari ini.`;
	} else if (timeMinutes >= 9 * 60) {
		// Lewat jam 09:00 WIB belum ada TBM
		tbmScore = 20;
		tbmStatus = 'overdue';
		tbmLabel = 'Terlambat (> 08:30)';
		tbmDetail = 'Briefing pagi belum tercatat lewat batas jam 08:30 WIB.';
		alerts.push({
			priority: 'high',
			icon: '🚨',
			message: 'TBM Safety Briefing pagi belum diisi. Pastikan arahan K3 & APD kru tercatat.',
			actionUrl: '/tbm-rollcall'
		});
	} else {
		tbmScore = 50;
		tbmStatus = 'pending';
		tbmLabel = 'Batas 08:30 WIB';
		tbmDetail = 'Laksanakan briefing pagi bersama seluruh personil sebelum mulai bekerja.';
	}

	checklist.push({
		key: 'tbm',
		title: '1. TBM Morning Briefing',
		slaTime: '08:00 WIB',
		status: tbmStatus,
		statusLabel: tbmLabel,
		detail: tbmDetail,
		actionLabel: tbmCount > 0 ? 'Lihat TBM' : 'Isi TBM Sekarang',
		actionUrl: '/tbm-rollcall',
		score: tbmScore,
		weight: 0.20
	});

	// 2. P2H Equipment (Target 08:30 WIB, Bobot 25%)
	const totalEq = records.activeEquipmentCount;
	let p2hScore = 100;
	let p2hStatus: DailyDisciplineChecklistItem['status'] = 'completed';
	let p2hLabel = 'Semua Selesai';
	let p2hDetail = 'Tidak ada alat berat/equipment aktif yang memerlukan checklist.';

	if (totalEq === 0) {
		p2hStatus = 'not_applicable';
		p2hLabel = 'N/A';
		p2hDetail = 'Proyek tidak memiliki unit equipment aktif di site.';
		p2hScore = 100;
	} else {
		const checkedIds = new Set(records.p2hList.map((p) => String(p.equipment_id)));
		const checkedCount = checkedIds.size;
		const noGoCount = records.p2hList.filter((p) => p.is_go === false || p.result === 'no_go' || p.status_kondisi === 'rusak').length;

		if (checkedCount >= totalEq) {
			if (noGoCount > 0) {
				p2hScore = 75;
				p2hStatus = 'warning';
				p2hLabel = `${noGoCount} Unit No-Go`;
				p2hDetail = `P2H selesai (${checkedCount}/${totalEq} unit), namun ada ${noGoCount} unit dinyatakan No-Go / butuh repair.`;
				alerts.push({
					priority: 'medium',
					icon: '⚠️',
					message: `Ditemukan ${noGoCount} unit equipment No-Go pada P2H hari ini. Laporkan work order ke mekanik.`,
					actionUrl: '/preventive'
				});
			} else {
				p2hScore = 100;
				p2hStatus = 'completed';
				p2hLabel = `100% Laik (${checkedCount}/${totalEq})`;
				p2hDetail = `Seluruh ${totalEq} unit equipment telah diperiksa dan dinyatakan GO (laik operasi).`;
			}
		} else {
			const missingCount = totalEq - checkedCount;
			if (timeMinutes >= 9 * 60) {
				p2hScore = Math.max(0, Math.round((checkedCount / totalEq) * 60));
				p2hStatus = 'overdue';
				p2hLabel = `Belum: ${missingCount} Unit`;
				p2hDetail = `${missingCount} dari ${totalEq} unit equipment belum diperiksa lewat batas 08:30 WIB.`;
				alerts.push({
					priority: 'high',
					icon: '🚜',
					message: `${missingCount} equipment site belum checklist P2H hari ini. Periksa sebelum alat dinyalakan.`,
					actionUrl: '/preventive'
				});
			} else {
				p2hScore = Math.max(40, Math.round((checkedCount / totalEq) * 100));
				p2hStatus = 'in_progress';
				p2hLabel = `${checkedCount}/${totalEq} Selesai`;
				p2hDetail = `Proses pemeriksaan P2H sedang berjalan (Batas 08:30 WIB).`;
			}
		}
	}

	checklist.push({
		key: 'p2h',
		title: '2. P2H Equipment',
		slaTime: '08:30 WIB',
		status: p2hStatus,
		statusLabel: p2hLabel,
		detail: p2hDetail,
		actionLabel: 'Checklist P2H',
		actionUrl: '/preventive',
		score: p2hScore,
		weight: 0.25
	});

	// 3. Presensi Kru Lapangan (Target Tepat Waktu & Geofence, Bobot 25%)
	const totalLogs = records.absensiList.length;
	let absensiScore = 100;
	let absensiStatus: DailyDisciplineChecklistItem['status'] = 'completed';
	let absensiLabel = 'Tertib';
	let absensiDetail = 'Log kehadiran personil.';

	if (totalLogs === 0) {
		if (timeMinutes >= 9 * 60) {
			absensiScore = 20;
			absensiStatus = 'warning';
			absensiLabel = 'Belum Ada Log';
			absensiDetail = 'Belum ada data presensi/absensi kru yang tercatat di site hari ini.';
			alerts.push({
				priority: 'medium',
				icon: '📍',
				message: 'Presensi kru site belum masuk. Pastikan seluruh pekerja melakukan check-in lokasi.',
				actionUrl: '/manpower'
			});
		} else {
			absensiScore = 60;
			absensiStatus = 'pending';
			absensiLabel = 'Menunggu Presensi';
			absensiDetail = 'Kru sedang proses check-in site pagi ini.';
		}
	} else {
		const lateCount = records.absensiList.filter((a) => a.is_late || (a.menit_keterlambatan && a.menit_keterlambatan > 0)).length;
		const outOfGeofenceCount = records.absensiList.filter((a) => a.is_geofence_valid === false || (a.jarak_meter && a.jarak_meter > 200)).length;
		const onTimeRate = Math.round(((totalLogs - lateCount) / totalLogs) * 100);
		const geofenceRate = Math.round(((totalLogs - outOfGeofenceCount) / totalLogs) * 100);

		absensiScore = Math.round(onTimeRate * 0.5 + geofenceRate * 0.5);
		if (absensiScore >= 85) {
			absensiStatus = 'completed';
			absensiLabel = `${totalLogs} Hadir (${onTimeRate}% Tepat)`;
			absensiDetail = `${totalLogs} kru tercatat hadir. Kepatuhan geofence ${geofenceRate}%.`;
		} else {
			absensiStatus = 'warning';
			absensiLabel = `${outOfGeofenceCount} Luar Radius`;
			absensiDetail = `${outOfGeofenceCount} absensi terdeteksi di luar radius site geofence atau terlambat.`;
		}
	}

	checklist.push({
		key: 'absensi',
		title: '3. Presensi Kru Lapangan',
		slaTime: '10:00 WIB',
		status: absensiStatus,
		statusLabel: absensiLabel,
		detail: absensiDetail,
		actionLabel: 'Pantau Presensi',
		actionUrl: '/manpower',
		score: absensiScore,
		weight: 0.25
	});

	// 4. Laporan Harian Proyek (Target SLA 20:00 WIB, Bobot 30%)
	const report = records.reportList[0];
	let reportScore = 0;
	let reportStatus: DailyDisciplineChecklistItem['status'] = 'pending';
	let reportLabel = 'Belum Dibuat';
	let reportDetail = 'Laporan harian mencakup progres fisik, cuaca, tenaga kerja & dokumentasi foto.';

	if (report) {
		const hasPhotos = (Array.isArray(report.progress_photos) && report.progress_photos.length > 0) ||
			(Array.isArray(report.area_kerja_photos) && report.area_kerja_photos.length > 0);

		if (report.is_susulan) {
			reportScore = 65;
			reportStatus = 'warning';
			reportLabel = 'Laporan Susulan';
			reportDetail = 'Laporan diinput sebagai susulan.';
		} else {
			reportScore = hasPhotos ? 100 : 85;
			reportStatus = 'completed';
			reportLabel = hasPhotos ? 'Lengkap & Terkirim' : 'Terkirim (Foto Minim)';
			reportDetail = `Laporan harian berhasil diinput. ${hasPhotos ? 'Dokumentasi foto lengkap.' : 'Lengkapi foto progres untuk validitas 100%.'}`;
		}
	} else {
		if (timeMinutes >= 20 * 60) {
			// Lewat batas SLA 20:00 WIB
			reportScore = 0;
			reportStatus = 'overdue';
			reportLabel = 'Overdue (> 20:00)';
			reportDetail = 'Batas pengiriman laporan harian (20:00 WIB) telah terlewati. Segera input malam ini.';
			alerts.push({
				priority: 'high',
				icon: '📋',
				message: 'Laporan harian proyek hari ini belum dikirim (SLA 20:00 WIB terlewati). Segera selesaikan.',
				actionUrl: reportActionUrl
			});
		} else if (timeMinutes >= 16 * 60) {
			reportScore = 40;
			reportStatus = 'in_progress';
			reportLabel = 'Siap Diisi (Sore)';
			reportDetail = 'Pekerjaan fisik sore selesai. Rangkum progres harian sebelum pukul 20:00 WIB.';
		} else {
			reportScore = 60;
			reportStatus = 'pending';
			reportLabel = 'Batas 20:00 WIB';
			reportDetail = 'Input dibuka menjelang akhir jam kerja harian site.';
		}
	}

	checklist.push({
		key: 'laporan',
		title: '4. Laporan Harian (LH)',
		slaTime: '20:00 WIB',
		status: reportStatus,
		statusLabel: reportLabel,
		detail: reportDetail,
		actionLabel: report ? 'Lihat Laporan' : 'Input Laporan',
		actionUrl: reportActionUrl,
		score: reportScore,
		weight: 0.30
	});

	// Total Skor Disiplin Harian (FDCI)
	const totalScore = Math.round(checklist.reduce((acc, c) => acc + c.score * c.weight, 0));

	let level: LeaderDailyDisciplineSummary['level'] = 'TELADAN';
	let badge: LeaderDailyDisciplineSummary['badge'] = {
		label: 'Sangat Tertib',
		badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
		bg: 'bg-emerald-50 dark:bg-emerald-950/40',
		text: 'text-emerald-700 dark:text-emerald-400',
		border: 'border-emerald-300 dark:border-emerald-800',
		summary: 'Seluruh checklist harian dilaksanakan tepat waktu sesuai standar operasional PT Eltama Prima Indo.'
	};

	if (totalScore < 50) {
		level = 'KRITIS';
		badge = {
			label: 'Perlu Perhatian Mendesak',
			badgeClass: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
			bg: 'bg-rose-50 dark:bg-rose-950/40',
			text: 'text-rose-700 dark:text-rose-400',
			border: 'border-rose-300 dark:border-rose-800',
			summary: 'Terdapat keterlambatan pengisian laporan harian atau pemeriksaan alat yang belum terlaksana.'
		};
	} else if (totalScore < 75) {
		level = 'PERHATIAN';
		badge = {
			label: 'Perlu Perbaikan',
			badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
			bg: 'bg-amber-50 dark:bg-amber-950/40',
			text: 'text-amber-700 dark:text-amber-400',
			border: 'border-amber-300 dark:border-amber-800',
			summary: 'Sebagian checklist belum tuntas. Lengkapi sebelum batas SLA berakhir.'
		};
	} else if (totalScore < 90) {
		level = 'BAIK';
		badge = {
			label: 'Disiplin Baik',
			badgeClass: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
			bg: 'bg-blue-50 dark:bg-blue-950/40',
			text: 'text-blue-700 dark:text-blue-400',
			border: 'border-blue-300 dark:border-blue-800',
			summary: 'Kepatuhan harian berjalan baik, pertahankan konsistensi dokumentasi lapangan.'
		};
	}

	let weeklyStreak: LeaderDailyDisciplineSummary['weeklyStreak'];
	if (records.weeklyReportList && records.weeklyReportList.length > 0) {
		const totalDays = records.weeklyReportList.length;
		let onTimeDays = 0;
		for (const r of records.weeklyReportList) {
			if (!r.is_susulan) onTimeDays++;
		}
		const streakPct = Math.round((onTimeDays / totalDays) * 100);
		weeklyStreak = { onTimeDays, totalDays, streakPct };
	}

	return {
		date,
		score: totalScore,
		level,
		badge,
		checklist,
		alerts,
		weeklyStreak
	};
}

// In-Memory Cache (TTL: 60 detik) untuk menghemat API
let cachedData: { at: number; key: string; data: LeaderDailyDisciplineSummary } | null = null;
const CACHE_TTL_MS = 60_000;

/**
 * Fetch data kedisiplinan harian Project Leader dari Directus
 * Directus fetching dipisah per relasi sesuai Rule #2.
 */
export async function fetchLeaderDailyDiscipline(
	projectIds: number[],
	equipmentIds: string[] = [],
	force = false
): Promise<LeaderDailyDisciplineSummary> {
	const today = todayWib();
	const cacheKey = `${projectIds.sort().join(',')}:${equipmentIds.sort().join(',')}:${today}`;

	if (!force && cachedData && cachedData.key === cacheKey && Date.now() - cachedData.at < CACHE_TTL_MS) {
		return cachedData.data;
	}

	if (!projectIds.length) {
		return computeLeaderDailyDiscipline({
			tbmList: [],
			p2hList: [],
			absensiList: [],
			reportList: [],
			activeEquipmentCount: 0
		}, today);
	}

	try {
		// Rule #2: Directus fetching must be separated for each relation
		const [tbmRes, p2hRes, absensiRes, reportRes] = await Promise.allSettled([
			// 1. TBM Morning Briefing
			directus.request(
				readItems('toolbox_meeting', {
					filter: { project_id: { _in: projectIds }, tanggal: { _eq: today } },
					fields: ['id', 'project_id', 'tanggal', 'status'],
					limit: 20
				})
			),
			// 2. P2H Equipment
			equipmentIds.length > 0
				? directus.request(
					readItems('p2h_session', {
						filter: { equipment_id: { _in: equipmentIds }, date: { _eq: today } },
						fields: ['id', 'equipment_id', 'is_go', 'result', 'status_kondisi'],
						limit: 50
					})
				)
				: Promise.resolve([]),
			// 3. Presensi Kru
			directus.request(
				readItems('manpower_absensi', {
					filter: { project_id: { _in: projectIds }, tanggal: { _eq: today } },
					fields: ['id', 'project_id', 'status', 'is_late', 'menit_keterlambatan', 'jarak_meter', 'is_geofence_valid'],
					limit: 100
				})
			),
			// 4. Laporan Harian (7 Hari Terakhir untuk Pantauan Streak & Hari Ini)
			directus.request(
				readItems('reports', {
					filter: { project_id: { _in: projectIds }, date: { _gte: new Date(Date.now() - 7 * 24 * 3600 * 1000 + 7 * 3600 * 1000).toISOString().slice(0, 10) } },
					fields: ['id', 'project_id', 'date', 'date_created', 'status', 'progress_photos', 'area_kerja_photos', 'attendance_photos', 'is_susulan'],
					limit: 50
				})
			)
		]);

		const tbmList = tbmRes.status === 'fulfilled' ? (tbmRes.value as any[]) : [];
		const p2hList = p2hRes.status === 'fulfilled' ? (p2hRes.value as any[]) : [];
		const absensiList = absensiRes.status === 'fulfilled' ? (absensiRes.value as any[]) : [];
		const allReports = reportRes.status === 'fulfilled' ? (reportRes.value as any[]) : [];
		const todayReports = allReports.filter((r) => r.date === today);

		const result = computeLeaderDailyDiscipline({
			tbmList,
			p2hList,
			absensiList,
			reportList: todayReports,
			weeklyReportList: allReports,
			activeEquipmentCount: equipmentIds.length,
			primaryProjectId: projectIds[0]
		}, today);

		cachedData = { at: Date.now(), key: cacheKey, data: result };
		return result;
	} catch (error) {
		console.warn('[leaderDisciplineDaily] Gagal fetch data kedisiplinan, fallback ke default aman:', error);
		return computeLeaderDailyDiscipline({
			tbmList: [],
			p2hList: [],
			absensiList: [],
			reportList: [],
			activeEquipmentCount: equipmentIds.length,
			primaryProjectId: projectIds[0]
		}, today);
	}
}
