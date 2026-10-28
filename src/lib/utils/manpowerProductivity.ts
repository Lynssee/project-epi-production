// src/lib/utils/manpowerProductivity.ts
// Modul kalkulasi produktivitas tenaga kerja harian (m2/orang-hari) di aplikasi lapangan (project-epi)

export interface ProductivityBenchmarks {
	productivity_blaster_m2_day: number; // default: 20
	productivity_painter_m2_day: number; // default: 80
	productivity_overall_m2_day: number; // default: 15
	anomaly_low_threshold_pct: number;   // default: 35
	anomaly_high_threshold_pct: number;  // default: 300
}

export const DEFAULT_BENCHMARKS: ProductivityBenchmarks = Object.freeze({
	productivity_blaster_m2_day: 20,
	productivity_painter_m2_day: 80,
	productivity_overall_m2_day: 15,
	anomaly_low_threshold_pct: 35,
	anomaly_high_threshold_pct: 300
});

export function isAreaUnit(unit?: string | null): boolean {
	if (!unit) return false;
	const u = String(unit).trim().toLowerCase();
	return u === 'm2' || u === 'm²' || u === 'meter persegi' || u === 'sqm';
}

export function extractVolume(row: any): number {
	if (!row || typeof row !== 'object') return 0;
	if (row.stages && typeof row.stages === 'object' && row.stages.pekerjaan !== undefined) {
		const n = Number(row.stages.pekerjaan);
		return Number.isFinite(n) && n > 0 ? n : 0;
	}
	const pv = Number(row.progress_value);
	return Number.isFinite(pv) && pv > 0 ? pv : 0;
}

export function isBlasting(row: any): boolean {
	if (!row) return false;
	const text = `${row.activity || ''} ${row.category || ''} ${row.service_type || ''} ${row.subtask_name || ''}`.toLowerCase();
	return /blast|sandblast|gritblast|vapor.*blast|water.*jet/i.test(text);
}

export function isPainting(row: any): boolean {
	if (!row) return false;
	const text = `${row.activity || ''} ${row.category || ''} ${row.service_type || ''} ${row.subtask_name || ''}`.toLowerCase();
	return /paint|cat|coating|primer|intermediate|topcoat|finish|aplikasi|lining/i.test(text);
}

export function countRole(manpowerRows: any[] = []): { blasters: number; painters: number; helpers: number; standbys: number; total: number } {
	let blasters = 0;
	let painters = 0;
	let helpers = 0;
	let standbys = 0;
	let total = 0;

	for (const r of manpowerRows || []) {
		if (!r) continue;
		const role = String(r.role || r.posisi || r.jabatan || '').toLowerCase();
		let count = 0;

		if (Array.isArray(r.workers)) {
			count = r.workers.filter(Boolean).length;
		} else if (Array.isArray(r.names)) {
			count = r.names.filter(Boolean).length;
		} else if (r.count !== undefined && Number.isFinite(Number(r.count))) {
			count = Math.max(0, Number(r.count));
		} else if (r.jumlah !== undefined && Number.isFinite(Number(r.jumlah))) {
			count = Math.max(0, Number(r.jumlah));
		} else {
			count = 1;
		}

		total += count;

		if (/standby|hold/i.test(role)) {
			standbys += count;
		} else if (/blast/i.test(role)) {
			blasters += count;
		} else if (/paint|aplikator|applicator|coating|epoxy/i.test(role)) {
			painters += count;
		} else {
			helpers += count;
		}
	}

	return { blasters, painters, helpers, standbys, total };
}

export interface DailyProductivityResult {
	volumeBlastingM2: number;
	volumePaintingM2: number;
	totalVolumeM2: number;
	blasters: number;
	painters: number;
	standbys: number;
	totalWorkers: number;
	blasterOutputM2PerDay: number;
	painterOutputM2PerDay: number;
	blasterRatioPct: number;
	painterRatioPct: number;
	hasData: boolean;
	statusTone: 'ok' | 'warn' | 'err' | 'none';
	hint: string;
}

export function computeDailyProductivity(
	progressRows: any[] = [],
	manpowerRows: any[] = [],
	benchmarks: Partial<ProductivityBenchmarks> = {}
): DailyProductivityResult {
	const cfg = { ...DEFAULT_BENCHMARKS, ...benchmarks };

	let volumeBlastingM2 = 0;
	let volumePaintingM2 = 0;
	let totalVolumeM2 = 0;

	for (const row of progressRows || []) {
		if (!row) continue;
		const vol = extractVolume(row);
		if (vol <= 0) continue;

		if (isBlasting(row)) {
			volumeBlastingM2 += vol;
		} else if (isPainting(row)) {
			volumePaintingM2 += vol;
		}
		totalVolumeM2 += vol;
	}

	const counts = countRole(manpowerRows);

	const blasterOutput = counts.blasters > 0
		? Math.round((volumeBlastingM2 / counts.blasters) * 10) / 10
		: 0;
	const painterOutput = counts.painters > 0
		? Math.round((volumePaintingM2 / counts.painters) * 10) / 10
		: 0;

	const blasterRatioPct = cfg.productivity_blaster_m2_day > 0 && blasterOutput > 0
		? Math.round((blasterOutput / cfg.productivity_blaster_m2_day) * 100)
		: 0;
	const painterRatioPct = cfg.productivity_painter_m2_day > 0 && painterOutput > 0
		? Math.round((painterOutput / cfg.productivity_painter_m2_day) * 100)
		: 0;

	const hasData = totalVolumeM2 > 0 || counts.total > 0;

	let statusTone: 'ok' | 'warn' | 'err' | 'none' = 'none';
	let hint = 'Isi volume pekerjaan dan daftar tenaga kerja untuk melihat kecepatan output hari ini.';

	if (hasData) {
		if ((volumeBlastingM2 > 0 && counts.blasters === 0) || (volumePaintingM2 > 0 && counts.painters === 0)) {
			statusTone = 'err';
			hint = '⚠️ Ada volume pekerjaan tercatat tanpa personil teknis yang sesuai (Blaster/Painter). Periksa kembali tab Tenaga.';
		} else if ((blasterRatioPct > 0 && blasterRatioPct < cfg.anomaly_low_threshold_pct) ||
		           (painterRatioPct > 0 && painterRatioPct < cfg.anomaly_low_threshold_pct)) {
			statusTone = 'warn';
			hint = '⚠️ Output fisik hari ini di bawah 35% target standar. Jika terhambat cuaca, izin PTW, atau mesin rusak, pastikan baris STANDBY atau catatan kendala terisi.';
		} else if (blasterRatioPct >= 100 || painterRatioPct >= 100) {
			statusTone = 'ok';
			hint = '✅ Kecepatan output hari ini mencapai / melampaui target standar benchmark.';
		} else if (blasterRatioPct >= 70 || painterRatioPct >= 70) {
			statusTone = 'ok';
			hint = '✓ Kecepatan output hari ini dalam rentang normal operasional.';
		} else {
			statusTone = 'warn';
			hint = 'ℹ️ Output tercatat di bawah standar optimal. Pantau ritme kerja atau pastikan kendala tercatat.';
		}
	}

	return {
		volumeBlastingM2: Math.round(volumeBlastingM2 * 100) / 100,
		volumePaintingM2: Math.round(volumePaintingM2 * 100) / 100,
		totalVolumeM2: Math.round(totalVolumeM2 * 100) / 100,
		blasters: counts.blasters,
		painters: counts.painters,
		standbys: counts.standbys,
		totalWorkers: counts.total,
		blasterOutputM2PerDay: blasterOutput,
		painterOutputM2PerDay: painterOutput,
		blasterRatioPct,
		painterRatioPct,
		hasData,
		statusTone,
		hint
	};
}
