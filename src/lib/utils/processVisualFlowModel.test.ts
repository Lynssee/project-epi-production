// src/lib/utils/processVisualFlowModel.test.ts
import { describe, it, expect } from 'vitest';
import {
	inferNodeIcon,
	sortProcessNodes,
	extractKeySummaryPoints,
	buildInfographicSteps,
	buildVisualWorkInstructions
} from './processVisualFlowModel';

describe('processVisualFlowModel (project-epi)', () => {
	it('mendeteksi ikon langkah berdasarkan kata kunci', () => {
		expect(inferNodeIcon({ label: 'Pembekuan Sesi Opname (Cut-Off)' })).toBe('🔒');
		expect(inferNodeIcon({ label: 'Penghitungan Fisik Lapangan' })).toBe('📦');
		expect(inferNodeIcon({ label: 'Rekonsiliasi Varians Selisih' })).toBe('⚖️');
		expect(inferNodeIcon({ label: 'Hitung Ulang Kedua (Recount)' })).toBe('🔁');
		expect(inferNodeIcon({ label: 'Investigasi Selisih & Karantina' })).toBe('🔬');
		expect(inferNodeIcon({ label: 'Otorisasi Penyesuaian (Approval)' })).toBe('✍️');
		expect(inferNodeIcon({ label: 'Posting Jurnal & Buka Cut-Off' })).toBe('📊');
	});

	it('mengurutkan node berdasarkan kolom dan baris', () => {
		const nodes: any[] = [
			{ id: 'b', col: 1, row: 0 },
			{ id: 'a', col: 0, row: 0 }
		];
		expect(sortProcessNodes(nodes).map((n) => n.id)).toEqual(['a', 'b']);
	});

	it('membangun infografis vertikal sesuai format Gambar 2', () => {
		const flow: any = {
			id: 'inventory_stock_opname',
			title: 'Alur Stock Opname',
			lanes: [{ key: 'gudang', label: 'Gudang' }],
			nodes: [
				{
					id: 'n1',
					col: 0,
					row: 0,
					type: 'start',
					lane: 'gudang',
					label: 'Cut-Off Sesi',
					desc: 'Bekukan mutasi barang',
					checklist: ['Cek cut-off jam 17:00', 'Segel pintu']
				}
			]
		};

		const info = buildInfographicSteps(flow);
		expect(info.totalSteps).toBe(1);
		expect(info.steps[0].stepNumber).toBe(1);
		expect(info.steps[0].icon).toBe('🔒');
		expect(info.steps[0].keyPoints.length).toBe(2);
	});

	it('membangun kartu instruksi visual sesuai format Gambar 1', () => {
		const flow: any = {
			id: 'inventory_stock_opname',
			title: 'Alur Stock Opname',
			nodes: [
				{
					id: 'n1',
					col: 0,
					label: 'Penghitungan Fisik',
					checklist: ['Scan barcode bin', 'Hitung fisik pail', 'Catat expired date', 'Tempel stiker SO']
				}
			]
		};

		const vwi = buildVisualWorkInstructions(flow);
		expect(vwi.totalSkills).toBe(1);
		expect(vwi.skills[0].cards.length).toBe(4);
		expect(vwi.skills[0].cards[3].isFinishedResult).toBe(true);
		expect(vwi.skills[0].cards[3].statusBadge).toBe('Finished result');
	});
});
