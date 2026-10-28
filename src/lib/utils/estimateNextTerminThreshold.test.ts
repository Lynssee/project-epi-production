import { describe, it, expect } from 'vitest';
import { estimateNextTerminThreshold } from './estimateNextTerminThreshold';

function makeProject(dailyActualByDate: Record<string, number>, volume = 100) {
	return {
		status: 'on progress',
		timeline_planning: {
			categories: [
				{
					subtasks: [
						{ volume, daily_plan: {}, daily_actual: dailyActualByDate, wajib_key: null, bobot_pct: 10 }
					]
				}
			]
		}
	};
}

describe('estimateNextTerminThreshold', () => {
	it('tidak ada termin not_started dengan ambang di atas progres -> null', () => {
		const project = makeProject({ '2026-09-01': 50 });
		const termins = [{ status: 'billed', progress_trigger_pct: 30 }];
		expect(estimateNextTerminThreshold(project, termins)).toBeNull();
	});

	it('semua ambang sudah <= progres sekarang -> null', () => {
		const project = makeProject({ '2026-09-01': 60 });
		const termins = [{ status: 'not_started', progress_trigger_pct: 50 }];
		expect(estimateNextTerminThreshold(project, termins)).toBeNull();
	});

	it('kurang data laporan harian (1 tanggal) -> daysEstimate null, tidak mengarang tanggal', () => {
		const project = makeProject({ '2026-09-01': 40 });
		const termins = [{ status: 'not_started', progress_trigger_pct: 60 }];
		const result = estimateNextTerminThreshold(project, termins);
        expect(result).not.toBeNull();
		expect(result!.daysEstimate).toBeNull();
		expect(result!.thresholdPct).toBe(60);
	});

	it('ada laju progres positif -> hitung perkiraan hari', () => {
		// volume 100, target subtask 100%: hari 1 = 20 unit (20%), hari 11 = 40 unit (40%) -> laju 2%/hari
		const project = makeProject({ '2026-09-01': 20, '2026-09-11': 20 });
		const termins = [{ status: 'not_started', progress_trigger_pct: 60 }];
		const result = estimateNextTerminThreshold(project, termins);
		expect(result).not.toBeNull();
		expect(result!.currentPct).toBe(40);
		expect(result!.daysEstimate).toBe(10); // (60-40)/2%per hari = 10 hari
	});

	it('memilih ambang TERDEKAT di atas progres sekarang, bukan yang terbesar', () => {
		const project = makeProject({ '2026-09-01': 50 });
		const termins = [
			{ status: 'not_started', progress_trigger_pct: 90 },
			{ status: 'not_started', progress_trigger_pct: 60 }
		];
		const result = estimateNextTerminThreshold(project, termins);
		expect(result!.thresholdPct).toBe(60);
	});

	it('laju sangat lambat (>365 hari) -> daysEstimate null', () => {
		// volume 10.000: hari 1 kumulatif 1 unit (0.01%), hari 11 kumulatif 2 unit (0.02%)
		// -> laju 0.001%/hari, butuh puluhan ribu hari mencapai ambang 90% -> tidak diperkirakan.
		const project = makeProject({ '2026-01-01': 1, '2026-01-11': 1 }, 10000);
		const termins = [{ status: 'not_started', progress_trigger_pct: 90 }];
		const result = estimateNextTerminThreshold(project, termins);
		expect(result!.daysEstimate).toBeNull();
	});
});
