import { describe, it, expect, vi } from 'vitest';

const settings: Record<string, any> = {
	'project.wizard.phases': [
		{ phase_key: 'inisiasi', phase_order: 1, phase_label: 'Inisiasi', gate_type: 'auto', checklist_items: [], enabled: true },
		{ phase_key: 'persiapan', phase_order: 3, phase_label: 'Persiapan', gate_type: 'mobilization', checklist_items: [], enabled: true }
	],
	'project.wizard.phases_workshop': [
		{ phase_key: 'eksekusi', phase_order: 4, phase_label: 'Produksi', gate_type: 'workshop_production', enabled: true,
			checklist_items: [{ id: 'ws_daily', label: 'Laporan Harian terisi', wajib: true }] },
		{ phase_key: 'inisiasi', phase_order: 1, phase_label: 'Inisiasi WS', gate_type: 'auto', checklist_items: [], enabled: true },
		{ phase_key: 'mati', phase_order: 2, phase_label: 'Nonaktif', gate_type: 'auto', checklist_items: [], enabled: false }
	]
};

vi.mock('./directus', () => ({ default: { request: vi.fn() }, handleDirectusError: vi.fn() }));
vi.mock('@directus/sdk', () => ({ readItems: vi.fn() }));
vi.mock('./projectSettings', () => ({
	loadProjectSettings: vi.fn(async () => settings),
	getProjectSetting: (k: string) => settings[k]
}));
vi.mock('./projectSiteSurvey', () => ({ getMobilizationChecklist: vi.fn(), setMobilizationCheck: vi.fn() }));
vi.mock('./projectClosureLapangan', () => ({
	getCloseoutChecklist: vi.fn(),
	setCloseoutCheck: vi.fn(),
	getClosureStatus: vi.fn(),
	getClosureEvaluation: vi.fn()
}));

import { getPhaseDefinitions, getPhaseChecklist, isWorkshopProject } from './projectPhaseApi';

describe('projectPhaseApi — fase workshop Ciketing', () => {
	it('isWorkshopProject hanya true untuk workshop=ciketing (tanpa tebakan)', () => {
		expect(isWorkshopProject({ workshop: 'ciketing' })).toBe(true);
		expect(isWorkshopProject({ workshop: ' Ciketing ' })).toBe(true);
		expect(isWorkshopProject({ workshop: 'balaraja' })).toBe(false);
		expect(isWorkshopProject({ workshop: null })).toBe(false);
		expect(isWorkshopProject(undefined)).toBe(false);
	});

	it('proyek site memakai fase umum', async () => {
		const defs = await getPhaseDefinitions({ workshop: null });
		expect(defs.map((d) => d.phase_key)).toEqual(['inisiasi', 'persiapan']);
	});

	it('proyek Ciketing memakai fase workshop: terurut & tanpa fase nonaktif', async () => {
		const defs = await getPhaseDefinitions({ workshop: 'ciketing' });
		expect(defs.map((d) => d.phase_key)).toEqual(['inisiasi', 'eksekusi']);
		expect(defs[0].phase_label).toBe('Inisiasi WS');
	});

	it('fallback ke fase umum bila fase workshop kosong', async () => {
		const backup = settings['project.wizard.phases_workshop'];
		settings['project.wizard.phases_workshop'] = [];
		const defs = await getPhaseDefinitions({ workshop: 'ciketing' });
		expect(defs.map((d) => d.phase_key)).toEqual(['inisiasi', 'persiapan']);
		settings['project.wizard.phases_workshop'] = backup;
	});

	it('gate workshop_* tampil sebagai syarat informasional (read-only, bukan centang)', async () => {
		const r = await getPhaseChecklist(1, 'eksekusi', { workshop: 'ciketing' });
		expect(r.readOnly).toBe(true);
		expect(r.informational).toBe(true);
		expect(r.items).toEqual([{ id: 'ws_daily', label: 'Laporan Harian terisi', wajib: true, checked: false }]);
	});
});
