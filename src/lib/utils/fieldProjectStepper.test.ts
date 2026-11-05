// src/lib/utils/fieldProjectStepper.test.ts
import { describe, expect, it } from 'vitest';
import {
	FIELD_PROJECT_STAGES,
	getStageById,
	findStageForKeyword,
	getMatchingFlowsForStage,
	saveSelectedStage,
	loadSelectedStage,
	inferFieldActionsForNode
} from './fieldProjectStepper';
import type { FlowSummary } from './processMyTasks';

describe('fieldProjectStepper', () => {
	it('memiliki tepat 5 tahapan sekuensial proyek lapangan', () => {
		expect(FIELD_PROJECT_STAGES).toHaveLength(5);
		expect(FIELD_PROJECT_STAGES.map((s) => s.id)).toEqual([1, 2, 3, 4, 5]);
		expect(FIELD_PROJECT_STAGES[0].key).toBe('pra_mobilisasi');
		expect(FIELD_PROJECT_STAGES[1].key).toBe('logistik_sjm');
		expect(FIELD_PROJECT_STAGES[2].key).toBe('blasting_coating_qc');
		expect(FIELD_PROJECT_STAGES[3].key).toBe('daily_report_manpower');
		expect(FIELD_PROJECT_STAGES[4].key).toBe('bast_closing_demobilisasi');
	});

	it('setiap tahap memiliki gate penjaga, tindakan cepat (actions), dan checkpoints', () => {
		for (const stage of FIELD_PROJECT_STAGES) {
			expect(stage.gates.length).toBeGreaterThan(0);
			expect(stage.actions.length).toBeGreaterThan(0);
			expect(stage.checkpoints.length).toBeGreaterThan(0);
			for (const action of stage.actions) {
				expect(action.href.startsWith('/')).toBe(true);
			}
		}
	});

	it('getStageById menemukan tahap sesuai id atau undefined jika tidak valid', () => {
		expect(getStageById(1)?.key).toBe('pra_mobilisasi');
		expect(getStageById(3)?.key).toBe('blasting_coating_qc');
		expect(getStageById(99)).toBeUndefined();
	});

	it('findStageForKeyword mencocokkan kata kunci ke tahap yang tepat', () => {
		expect(findStageForKeyword('jsa')?.id).toBe(1);
		expect(findStageForKeyword('surat jalan')?.id).toBe(2);
		expect(findStageForKeyword('blasting')?.id).toBe(3);
		expect(findStageForKeyword('laporan harian')?.id).toBe(4);
		expect(findStageForKeyword('bast')?.id).toBe(5);
		expect(findStageForKeyword('kata tidak dikenal')).toBeUndefined();
	});

	it('getMatchingFlowsForStage menyaring alur relevan dengan kata kunci tahap', () => {
		const sampleFlows: FlowSummary[] = [
			{ id: 'f1', title: 'SOP JSA dan Izin Kerja K3', description: '', version: 1, node_count: 5, procedure_type: 'emergency_qhse' },
			{ id: 'f2', title: 'Penerimaan Surat Jalan Masuk', description: '', version: 1, node_count: 4, procedure_type: 'field_ops' },
			{ id: 'f3', title: 'Aplikasi Blasting dan Coating Sa 2.5', description: '', version: 1, node_count: 6, procedure_type: 'field_ops' },
			{ id: 'f4', title: 'Alur Payroll Kantor', description: '', version: 1, node_count: 3, procedure_type: 'administrative' }
		];

		const stage1 = getStageById(1)!;
		const stage3 = getStageById(3)!;

		const match1 = getMatchingFlowsForStage(stage1, sampleFlows);
		expect(match1.some((f) => f.id === 'f1')).toBe(true);

		const match3 = getMatchingFlowsForStage(stage3, sampleFlows);
		expect(match3.some((f) => f.id === 'f3')).toBe(true);
	});

	it('saveSelectedStage dan loadSelectedStage membaca dan menyimpan dari storage dengan aman', () => {
		const store = new Map<string, string>();
		const mockStorage = {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => { store.set(k, v); }
		};

		expect(loadSelectedStage(mockStorage, 1)).toBe(1);
		saveSelectedStage(mockStorage, 3);
		expect(loadSelectedStage(mockStorage, 1)).toBe(3);

		// Nilai tidak valid jatuh ke default
		store.set('epi_field_project_active_stage', 'invalid');
		expect(loadSelectedStage(mockStorage, 1)).toBe(1);
	});

	it('inferFieldActionsForNode memberikan tautan modul yang relevan saat tindakan belum ada', () => {
		const actBlasting = inferFieldActionsForNode('Inspeksi Sandblasting Sa 2.5', 'Pengukuran kekasaran permukaan');
		expect(actBlasting.some((a) => a.href === '/inspection')).toBe(true);

		const actSj = inferFieldActionsForNode('Penerimaan Surat Jalan di Gerbang Site', 'Scan barcode dan periksa fisik');
		expect(actSj.some((a) => a.href === '/sji')).toBe(true);

		const actJsa = inferFieldActionsForNode('Briefing JSA dan K3', 'Memastikan APD lengkap');
		expect(actJsa.some((a) => a.href === '/jsa')).toBe(true);

		const actReport = inferFieldActionsForNode('Laporan Harian Progres Lapangan', 'Mencatat luasan m2 dan cuaca');
		expect(actReport.some((a) => a.href === '/field-report')).toBe(true);
	});
});

