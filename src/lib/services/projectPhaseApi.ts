// src/lib/services/projectPhaseApi.ts
// Project Phase Wizard, sisi Lapangan — HANYA membaca posisi fase & mendelegasikan checklist
// ke service yang sudah ada (projectSiteSurvey.ts untuk mobilisasi, projectClosureLapangan.ts
// untuk closeout). Leader tidak bisa memulai/skip fase — itu tetap wewenang Admin (erp-epi-1).
// Definisi fase (project.wizard.phases) satu sumber dengan admin, lihat projectSettings.ts.

import directus, { handleDirectusError } from './directus';
import { readItems } from '@directus/sdk';
import { getProjectSetting, loadProjectSettings } from './projectSettings';
import { getMobilizationChecklist, setMobilizationCheck } from './projectSiteSurvey';
import { getCloseoutChecklist, setCloseoutCheck, getClosureStatus, getClosureEvaluation } from './projectClosureLapangan';

export interface PhaseDefinition {
	phase_key: string;
	phase_order: number;
	phase_label: string;
	phase_icon: string;
	phase_color: string;
	description: string;
	hint_text: string;
	gate_type: string;
	checklist_items: Array<{ id: string; label: string; source?: string; wajib: boolean }>;
	pic_roles: string[];
	target_duration_days: number | null;
	enabled: boolean;
}

export interface PhaseChecklistResult {
	items: Array<{ id: string; label: string; wajib: boolean; checked: boolean; checkedBy?: string; checkedAt?: string }>;
	pct: number;
	passed: boolean;
	readOnly: boolean;
}

/** Definisi fase dari settings (project.wizard.phases), urut phase_order, hanya yang enabled. */
export async function getPhaseDefinitions(): Promise<PhaseDefinition[]> {
	await loadProjectSettings();
	const phases = (getProjectSetting('project.wizard.phases') || []) as PhaseDefinition[];
	return phases.filter((p) => p.enabled !== false).sort((a, b) => (a.phase_order || 0) - (b.phase_order || 0));
}

export function isWizardEnabled(): boolean {
	return !!getProjectSetting('project.wizard.enabled');
}

/** Baris project_phase_progress untuk satu proyek (read-only — ditulis oleh admin), key = phase_key. */
export async function getProjectPhases(projectId: number): Promise<Record<string, any>> {
	try {
		const rows: any[] = await directus.request(
			readItems('project_phase_progress', { filter: { project_id: { _eq: projectId } }, limit: -1 })
		);
		return Object.fromEntries(rows.map((r) => [r.phase_key, r]));
	} catch (error) {
		handleDirectusError(error);
		return {};
	}
}

/**
 * Hitung fase aktif read-only dari data existing (status proyek + project_closure) — logika
 * sama dengan projectPhaseApi.js admin, versi ringkas untuk tampilan lapangan.
 */
export async function computeCurrentPhase(project: {
	id: number;
	status?: string;
	so_customer_id?: number | string | null;
}): Promise<string> {
	if (!project?.id) return 'inisiasi';
	const closure = await getClosureStatus(project.id).catch(() => null);

	if (project.status === 'closed' && closure?.stage === 'closed') return 'closing';
	if (closure?.stage === 'approved') return 'closing';
	if (closure?.stage && ['draft', 'report_generated', 'evaluated', 'presented'].includes(closure.stage)) return 'evaluasi';
	if (project.status === 'on progress') return 'eksekusi';

	const phases = await getProjectPhases(project.id);
	if (phases['persiapan']?.status === 'completed' || phases['persiapan']?.status === 'in_progress') return 'persiapan';
	if (project.so_customer_id) return 'perencanaan';
	return 'inisiasi';
}

/**
 * Checklist untuk satu fase — delegasi ke service yang sudah ada sesuai gate_type. Fase yang
 * bukan wewenang leader (readiness/evaluation) dikembalikan read-only tanpa item interaktif.
 */
export async function getPhaseChecklist(projectId: number, phaseKey: string): Promise<PhaseChecklistResult> {
	const defs = await getPhaseDefinitions();
	const def = defs.find((p) => p.phase_key === phaseKey);
	if (!def) return { items: [], pct: 0, passed: false, readOnly: true };

	switch (def.gate_type) {
		case 'mobilization': {
			const rows = await getMobilizationChecklist(projectId);
			const items = rows.map((r) => ({ id: r.id, label: r.label, wajib: r.wajib, checked: r.checked, checkedBy: r.checkedBy, checkedAt: r.checkedAt }));
			const wajib = items.filter((i) => i.wajib);
			const pct = wajib.length ? Math.round((wajib.filter((i) => i.checked).length / wajib.length) * 100) : 100;
			return { items, pct, passed: wajib.every((i) => i.checked), readOnly: false };
		}

		case 'closure_approval': {
			const rows = await getCloseoutChecklist(projectId);
			const items = rows.map((r) => ({ id: r.id, label: r.label, wajib: r.wajib, checked: r.checked, checkedBy: r.checkedBy, checkedAt: r.checkedAt }));
			const wajib = items.filter((i) => i.wajib);
			const pct = wajib.length ? Math.round((wajib.filter((i) => i.checked).length / wajib.length) * 100) : 100;
			return { items, pct, passed: wajib.every((i) => i.checked), readOnly: false };
		}

		case 'evaluation': {
			const closure = await getClosureStatus(projectId);
			const evaluation = await getClosureEvaluation(projectId);
			const items = [
				{ id: 'final_report', label: 'Laporan akhir digenerate', wajib: true, checked: !!closure?.final_report_file },
				{ id: 'evaluation_filled', label: 'Evaluasi 5 dimensi terisi', wajib: true, checked: !!evaluation }
			];
			const pct = Math.round((items.filter((i) => i.checked).length / items.length) * 100);
			return { items, pct, passed: items.every((i) => i.checked), readOnly: true };
		}

		case 'readiness':
		case 'auto':
		default:
			// Wewenang Admin/PM — leader melihat status saja, tanpa checklist interaktif di sini.
			return { items: [], pct: 0, passed: false, readOnly: true };
	}
}

/** Centang satu item checklist fase (hanya untuk gate_type yang leader boleh isi: mobilisasi & closeout). */
export async function setPhaseCheck(
	projectId: number,
	phaseKey: string,
	itemId: string,
	checked: boolean,
	actorName: string
): Promise<void> {
	const defs = await getPhaseDefinitions();
	const def = defs.find((p) => p.phase_key === phaseKey);
	if (!def) throw new Error(`Fase "${phaseKey}" tidak ditemukan`);

	if (def.gate_type === 'mobilization') {
		await setMobilizationCheck(projectId, itemId, checked, actorName);
		return;
	}
	if (def.gate_type === 'closure_approval') {
		await setCloseoutCheck(projectId, itemId, checked, actorName);
		return;
	}
	throw new Error(`Fase "${phaseKey}" bukan checklist yang bisa diisi leader`);
}
