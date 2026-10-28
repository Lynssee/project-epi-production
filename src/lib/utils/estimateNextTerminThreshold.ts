// src/lib/utils/estimateNextTerminThreshold.ts
// Kartu "Target Termin Berikutnya" (Timeline Termin Pembayaran, Cashflow Inflow & Forecast
// Terpadu v2, Fase 4 lapangan, 17 Sep 2026): "Ambang X% · progres sekarang Y% · perkiraan
// tercapai ~N hari lagi" — TANPA Rupiah (Aturan lapangan: tak boleh nilai kontrak/margin).
//
// Murni (tanpa I/O), memakai calculateProjectProgressPercentage() yang sudah ada di
// projectProgress.ts sebagai satu-satunya sumber progres fisik (tidak dihitung ulang
// dengan rumus berbeda). Perkiraan hari dari laju rata-rata progres aktual harian
// (timeline_planning.categories[].subtasks[].daily_actual) — kalau data kurang, TIDAK
// mengarang tanggal (selaras koreksi rencana admin §1.4: tanpa baseline = tanpa tanggal).

import { calculateProjectProgressPercentage } from './projectProgress';

export interface NextTerminEstimate {
	thresholdPct: number;
	currentPct: number;
	/** null = tidak cukup data untuk memperkirakan (JANGAN dikarang). */
	daysEstimate: number | null;
	reason: string;
}

interface TerminLike {
	status?: string | null;
	progress_trigger_pct?: number | null;
}

function num(v: unknown): number {
	const n = parseFloat(String(v));
	return Number.isFinite(n) ? n : 0;
}

/** Laju rata-rata progres AKTUAL (%/hari), dari titik data pertama & terakhir yang tercatat. */
function computeDailyPaceRate(project: any): number | null {
	let planning = project?.timeline_planning;
	if (typeof planning === 'string') {
		try { planning = JSON.parse(planning); } catch { planning = null; }
	}
	const categories = planning?.categories || [];
	if (categories.length === 0) return null;

	const validCategories = categories
		.map((cat: any) => ({
			...cat,
			subtasks: (cat.subtasks || []).filter((sub: any) => num(sub.bobot_pct) !== 0 || !sub.wajib_key)
		}))
		.filter((cat: any) => cat.subtasks.length > 0);
	if (validCategories.length === 0) return null;

	const dateKeySet = new Set<string>();
	for (const cat of validCategories) {
		for (const sub of cat.subtasks) {
			Object.keys(sub.daily_actual || {}).forEach((k) => dateKeySet.add(k));
		}
	}
	const dateKeys = [...dateKeySet].sort();
	if (dateKeys.length < 2) return null;

	// Kumulatif rata-rata % aktual (tak berbobot antar kategori) per tanggal, sama pola
	// dengan calculateProjectProgressPercentage() (rata-rata per kategori).
	const pctAtDate = (uptoIdx: number): number => {
		let totalCatPct = 0;
		let validCount = 0;
		for (const cat of validCategories) {
			let totalSubPct = 0;
			for (const sub of cat.subtasks) {
				let actualVolume = 0;
				for (const dk of dateKeys.slice(0, uptoIdx + 1)) {
					actualVolume += num((sub.daily_actual || {})[dk]);
				}
				const subVol = num(sub.volume);
				const planVol = Object.values(sub.daily_plan || {}).reduce((s: number, v: any) => s + num(v), 0);
				const targetVol = subVol > 0 ? subVol : (planVol > 0 ? planVol : 0);
				const subPct = targetVol > 0 ? Math.min(100, (actualVolume / targetVol) * 100) : (actualVolume > 0 ? 100 : 0);
				totalSubPct += subPct;
			}
			totalCatPct += totalSubPct / cat.subtasks.length;
			validCount++;
		}
		return validCount > 0 ? totalCatPct / validCount : 0;
	};

	const firstPct = pctAtDate(0);
	const lastPct = pctAtDate(dateKeys.length - 1);
	const firstDate = new Date(dateKeys[0]);
	const lastDate = new Date(dateKeys[dateKeys.length - 1]);
	const days = Math.round((lastDate.getTime() - firstDate.getTime()) / 86400000);

	if (days <= 0 || lastPct <= firstPct) return null;
	return (lastPct - firstPct) / days;
}

/**
 * Termin belum dimulai dengan ambang progres TERDEKAT di atas progres sekarang.
 * @returns null bila tidak ada termin `not_started` dengan ambang di atas progres sekarang
 *   (semua sudah tercapai, atau kontrak tanpa ambang yang tersisa).
 */
export function estimateNextTerminThreshold(project: any, termins: TerminLike[]): NextTerminEstimate | null {
	const currentPct = calculateProjectProgressPercentage(project);

	const candidates = (termins || []).filter(
		(t) => t.status === 'not_started' && t.progress_trigger_pct != null && (t.progress_trigger_pct as number) > currentPct
	);
	if (candidates.length === 0) return null;

	const next = candidates.reduce((min, t) =>
		(t.progress_trigger_pct as number) < (min.progress_trigger_pct as number) ? t : min
	);
	const thresholdPct = next.progress_trigger_pct as number;

	const rate = computeDailyPaceRate(project);
	if (!rate || rate <= 0) {
		return {
			thresholdPct,
			currentPct,
			daysEstimate: null,
			reason: 'Belum cukup data laporan harian untuk memperkirakan (isi laporan harian secara rutin).'
		};
	}

	const daysEstimate = Math.ceil((thresholdPct - currentPct) / rate);
	if (daysEstimate > 365) {
		return {
			thresholdPct,
			currentPct,
			daysEstimate: null,
			reason: 'Laju progres saat ini terlalu lambat untuk diperkirakan secara wajar.'
		};
	}

	return {
		thresholdPct,
		currentPct,
		daysEstimate,
		reason: `Berdasarkan laju rata-rata progres ${rate.toFixed(2)}%/hari dari laporan harian.`
	};
}
