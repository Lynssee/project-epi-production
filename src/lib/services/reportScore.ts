import directus, { handleDirectusError } from './directus';
import { readItems } from '@directus/sdk';

export interface ProjectReportScore {
	projectId: number | string;
	projectName: string;
	totalWorkDays: number;   // hari kerja bulan ini (Senin–Sabtu)
	reportedDays: number;    // hari yang sudah ada laporan
	score: number;           // persentase (0–100)
}

export interface LeaderReportScore {
	month: string;           // e.g. "Juni 2025"
	totalScore: number;      // rata-rata dari semua proyek (0–100)
	projects: ProjectReportScore[];
}

/**
 * Hitung hari kerja (Senin–Sabtu) dalam rentang tanggal.
 * Hari Minggu (0) dikecualikan.
 */
function countWorkDays(start: Date, end: Date): number {
	let count = 0;
	const cur = new Date(start);
	cur.setHours(0, 0, 0, 0);
	const endDate = new Date(end);
	endDate.setHours(0, 0, 0, 0);
	while (cur <= endDate) {
		const day = cur.getDay(); // 0=Minggu, 6=Sabtu
		if (day !== 0) count++;   // Senin–Sabtu
		cur.setDate(cur.getDate() + 1);
	}
	return count;
}

export type ReportPeriod = 'hari_ini' | 'mingguan' | 'bulanan' | 'tanggal';

/**
 * Hitung skor laporan untuk leader berdasarkan periode yang dipilih.
 *
 * @param projects  - array proyek milik leader (minimal {id, name})
 * @param period    - periode perhitungan ('hari_ini' | 'mingguan' | 'bulanan' | 'tanggal')
 * @param customDateStr - string tanggal untuk filter khusus (YYYY-MM-DD)
 */
export async function getLeaderReportScore(
	projects: Array<{ id: number | string; name: string }>,
	period: ReportPeriod = 'bulanan',
	customDateStr?: string
): Promise<LeaderReportScore> {
	const now = new Date();
	let endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

	let startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
	let periodLabel = now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

	if (period === 'hari_ini') {
		startDate = new Date(endDate);
		periodLabel = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
	} else if (period === 'tanggal' && customDateStr) {
		const parts = customDateStr.split('-');
		if (parts.length === 3) {
			endDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
			startDate = new Date(endDate);
			periodLabel = endDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
		}
	} else if (period === 'mingguan') {
		const day = endDate.getDay();
		const diff = endDate.getDate() - day + (day === 0 ? -6 : 1); // Senin sebagai awal minggu
		startDate = new Date(endDate);
		startDate.setDate(diff);
		periodLabel = 'Minggu Ini';
	}

	const totalWorkDaysUntilToday = countWorkDays(startDate, endDate);

	if (projects.length === 0 || totalWorkDaysUntilToday === 0) {
		return { month: periodLabel, totalScore: 0, projects: [] };
	}

	const projectIds = projects.map(p => p.id);

	// Format tanggal: YYYY-MM-DD
	const startStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
	const endDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

	let reports: any[] = [];
	try {
		reports = await directus.request(
			readItems('reports', {
				filter: {
					project_id: { _in: projectIds as string[] },
					date: { _gte: startStr, _lte: endDateStr }
				},
				fields: ['id', 'project_id', 'date'],
				limit: -1
			})
		);
	} catch (error) {
		handleDirectusError(error);
		reports = [];
	}

	// Kelompokkan laporan per project_id
	// Pakai Set untuk menghindari duplikat tanggal per proyek
	const reportMap = new Map<string, Set<string>>();
	for (const r of reports) {
		const pid = String(
			typeof r.project_id === 'object' ? r.project_id?.id : r.project_id
		);
		const dateKey = r.date ? String(r.date).substring(0, 10) : '';
		if (!dateKey) continue;
		if (!reportMap.has(pid)) reportMap.set(pid, new Set());
		reportMap.get(pid)!.add(dateKey);
	}

	// Hitung skor per proyek
	const projectScores: ProjectReportScore[] = projects.map(p => {
		const pid = String(p.id);
		const reported = reportMap.get(pid)?.size ?? 0;
		const score = totalWorkDaysUntilToday > 0
			? Math.round((reported / totalWorkDaysUntilToday) * 100)
			: 0;
		return {
			projectId: p.id,
			projectName: p.name,
			totalWorkDays: totalWorkDaysUntilToday,
			reportedDays: reported,
			score: Math.min(score, 100)
		};
	});

	// Skor total = rata-rata semua proyek
	const totalScore = projectScores.length > 0
		? Math.round(projectScores.reduce((sum, p) => sum + p.score, 0) / projectScores.length)
		: 0;

	return {
		month: periodLabel,
		totalScore,
		projects: projectScores.sort((a, b) => a.score - b.score) // yang terendah duluan
	};
}
