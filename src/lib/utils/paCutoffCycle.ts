// src/lib/utils/paCutoffCycle.ts
// Logika Siklus Jadwal Pengajuan Anggaran Mingguan Lapangan (Rabu Cutoff -> Kamis Review -> Jumat Rilis).
// Sinkron dengan kalkulasi backend di erp-epi.

export interface CutoffCycleOptions {
	cutoffDay?: number; // 1=Senin..7=Minggu (bawaan 3/Rabu)
	cutoffTime?: string; // Jam batas cutoff (bawaan '17:00')
	releaseDay?: number; // Hari rilis mingguan (bawaan 5/Jumat)
	isEmergency?: boolean;
	emergencyReason?: string;
	minReasonLength?: number;
	exemptCategories?: string[];
	kategoriBelanja?: string;
}

export interface PaBatchCycleResult {
	subDate: Date;
	subWeekday: number;
	cutoffThisWeek: Date;
	releaseThisWeek: Date;
	releaseNextWeek: Date;
	targetReleaseDate: Date;
	batchRilisTarget: string; // YYYY-MM-DD
	batchLabel: string; // e.g. "13 Nov 2026"
	batchCode: 'W0' | 'W+1';
	isPostCutoff: boolean;
	isEmergencyFastTrack: boolean;
	isExempt: boolean;
	isEmergency: boolean;
	emergencyReason: string;
	reasonValid: boolean;
	cycleDescription: string;
}

export function parseCutoffTime(timeStr?: string | null): { hours: number; minutes: number } {
	if (!timeStr || typeof timeStr !== 'string') return { hours: 17, minutes: 0 };
	const parts = timeStr.trim().split(':');
	const h = parseInt(parts[0], 10);
	const m = parseInt(parts[1], 10);
	return {
		hours: Number.isFinite(h) && h >= 0 && h <= 23 ? h : 17,
		minutes: Number.isFinite(m) && m >= 0 && m <= 59 ? m : 0
	};
}

export function formatIsoDate(date: Date): string {
	const d = new Date(date);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

export function formatIndoDate(date: Date): string {
	const d = new Date(date);
	return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function getIsoWeekday(date: Date): number {
	const day = date.getDay();
	return day === 0 ? 7 : day;
}

export function computePaBatchCycle(
	submissionInput?: Date | string | number,
	options: CutoffCycleOptions = {}
): PaBatchCycleResult {
	const subDate = submissionInput ? new Date(submissionInput) : new Date();
	const cutoffDay = Number(options.cutoffDay) || 3;
	const cutoffTime = options.cutoffTime || '17:00';
	const releaseDay = Number(options.releaseDay) || 5;
	const isEmergency = Boolean(options.isEmergency);
	const emergencyReason = String(options.emergencyReason || '').trim();
	const minReasonLength = Number(options.minReasonLength) || 20;
	const exemptCategories = Array.isArray(options.exemptCategories) ? options.exemptCategories : ['petty_cash'];
	const kategoriBelanja = options.kategoriBelanja ? String(options.kategoriBelanja).trim() : '';

	const isExempt = !!kategoriBelanja && exemptCategories.includes(kategoriBelanja);
	const subWeekday = getIsoWeekday(subDate);
	const { hours: cutoffHours, minutes: cutoffMinutes } = parseCutoffTime(cutoffTime);

	// Senin 00:00:00 minggu berjalan
	const monday = new Date(subDate);
	monday.setDate(subDate.getDate() - (subWeekday - 1));
	monday.setHours(0, 0, 0, 0);

	// Cutoff minggu ini
	const cutoffThisWeek = new Date(monday);
	cutoffThisWeek.setDate(monday.getDate() + (cutoffDay - 1));
	cutoffThisWeek.setHours(cutoffHours, cutoffMinutes, 0, 0);

	// Jumat rilis minggu ini (W0)
	const releaseThisWeek = new Date(monday);
	releaseThisWeek.setDate(monday.getDate() + (releaseDay - 1));
	releaseThisWeek.setHours(12, 0, 0, 0);

	// Jumat rilis pekan depan (W+1)
	const releaseNextWeek = new Date(releaseThisWeek);
	releaseNextWeek.setDate(releaseThisWeek.getDate() + 7);

	let isPostCutoff = false;
	let targetReleaseDate = releaseThisWeek;
	let isEmergencyFastTrack = false;
	let batchCode: 'W0' | 'W+1' = 'W0';

	if (isExempt) {
		targetReleaseDate = subDate > releaseThisWeek ? releaseNextWeek : releaseThisWeek;
		batchCode = subDate > releaseThisWeek ? 'W+1' : 'W0';
	} else if (subDate <= cutoffThisWeek) {
		isPostCutoff = false;
		targetReleaseDate = releaseThisWeek;
		batchCode = 'W0';
	} else if (subWeekday > releaseDay || (subWeekday === releaseDay && subDate.getHours() >= 12)) {
		isPostCutoff = false;
		targetReleaseDate = releaseNextWeek;
		batchCode = 'W+1';
	} else {
		isPostCutoff = true;
		if (isEmergency && emergencyReason.length >= minReasonLength) {
			isEmergencyFastTrack = true;
			targetReleaseDate = releaseThisWeek;
			batchCode = 'W0';
		} else {
			targetReleaseDate = releaseNextWeek;
			batchCode = 'W+1';
		}
	}

	const reasonValid = !isEmergency || emergencyReason.length >= minReasonLength;
	const targetIso = formatIsoDate(targetReleaseDate);
	const targetLabel = formatIndoDate(targetReleaseDate);

	let cycleDescription = `Batch Rilis Jumat ${targetLabel}`;
	if (isEmergencyFastTrack) {
		cycleDescription += ' (Jalur Cepat Darurat)';
	} else if (isPostCutoff && batchCode === 'W+1') {
		cycleDescription += ' (Jadwal Pasca-Cutoff)';
	}

	return {
		subDate,
		subWeekday,
		cutoffThisWeek,
		releaseThisWeek,
		releaseNextWeek,
		targetReleaseDate,
		batchRilisTarget: targetIso,
		batchLabel: targetLabel,
		batchCode,
		isPostCutoff,
		isEmergencyFastTrack,
		isExempt,
		isEmergency,
		emergencyReason,
		reasonValid,
		cycleDescription
	};
}

export interface CutoffCountdown {
	isPassed: boolean;
	totalMs: number;
	days: number;
	hours: number;
	minutes: number;
	countdownText: string;
}

export function getCutoffCountdown(cutoffDate: Date, currentDate: Date = new Date()): CutoffCountdown {
	const diffMs = cutoffDate.getTime() - currentDate.getTime();
	if (diffMs <= 0) {
		return {
			isPassed: true,
			totalMs: diffMs,
			days: 0,
			hours: 0,
			minutes: 0,
			countdownText: 'Batas cutoff telah lewat'
		};
	}

	const totalMinutes = Math.floor(diffMs / (1000 * 60));
	const days = Math.floor(totalMinutes / (60 * 24));
	const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
	const minutes = totalMinutes % 60;

	let text = 'Sisa ';
	if (days > 0) {
		text += `${days} hari ${hours} jam`;
	} else if (hours > 0) {
		text += `${hours} jam ${minutes} menit`;
	} else {
		text += `${minutes} menit lagi`;
	}

	return {
		isPassed: false,
		totalMs: diffMs,
		days,
		hours,
		minutes,
		countdownText: text
	};
}
