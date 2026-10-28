// src/lib/services/b2bStatusApi.ts
// Rencana B2B Payment — Fase 2 (Dashboard Lapangan, 3 Okt 2026).
// READ-ONLY, TANPA rupiah DAN TANPA nama vendor/subkon (keputusan Lead 3 Okt 2026, Q5) —
// PL hanya lihat jumlah item + label generik termin (mis. "DP", "Termin 1"), bukan
// "PT XYZ" atau nominal. Pola sama dengan penagihanProyek.ts: fetching TERPISAH per
// koleksi, nol query relasi bersarang.
//
// Rantai fetch: project_contract (b2b_mode aktif) -> project_contract_termin
// (b2b_linked_payables) -> purchase_invoices / manpower_borongan_termin (HANYA
// id + b2b_hold_status, kolom nominal/nama tidak diminta sama sekali).

import directus from './directus';
import { readItems } from '@directus/sdk';
import { getProjectSetting } from './projectSettings';

export type B2BHoldStatus = 'waiting_client' | 'partial_released' | 'released' | null;

export interface B2BLinkedItem {
	payable_type: 'PURCHASE_INVOICE' | 'BORONGAN_TERMIN';
	label: string; // generik — nomor invoice / label termin borongan, BUKAN nama vendor
	hold_status: B2BHoldStatus;
}

export interface B2BTerminStatusRow {
	project_id: number | string;
	project_name: string;
	contract_id: number | string;
	b2b_mode: 'main_contractor' | 'subcontractor';
	termin_id: number | string;
	termin_label: string;
	urutan: number;
	termin_status: string;
	items: B2BLinkedItem[];
	waitingCount: number;
	partialCount: number;
	releasedCount: number;
}

function resolveId(v: any): number | string | null {
	if (v === null || v === undefined) return null;
	return typeof v === 'object' ? (v.id ?? null) : v;
}

/**
 * Status B2B (hold/release) per termin kontrak, untuk proyek-proyek yang diberikan.
 * Mengembalikan [] bila master switch (project.b2b.enabled) mati — dicek SETELAH
 * loadProjectSettings() dipanggil oleh pemanggil (pola sama dgn penagihanProyek.ts).
 */
export async function fetchB2BStatusForProjects(
	projects: Array<{ id: number | string; name: string }>
): Promise<B2BTerminStatusRow[]> {
	if (!projects || projects.length === 0) return [];
	if (getProjectSetting('project.b2b.enabled') !== true) return [];

	const projectIds = projects.map((p) => p.id);
	const projectNameById = new Map(projects.map((p) => [String(p.id), p.name]));

	try {
		// 1) Kontrak proyek dengan mode B2B aktif — koleksi TERPISAH.
		const contracts = (await directus.request(
			readItems('project_contract' as any, {
				filter: { project_id: { _in: projectIds }, b2b_mode: { _nnull: true } },
				fields: ['id', 'project_id', 'b2b_mode'],
				limit: -1
			})
		)) as any[];
		if (!contracts.length) return [];
		const contractIds = contracts.map((c) => c.id);
		const contractMeta = new Map(
			contracts.map((c) => [String(c.id), { projectId: resolveId(c.project_id), b2bMode: c.b2b_mode }])
		);

		// 2) Termin per kontrak — koleksi TERPISAH.
		const termins = (await directus.request(
			readItems('project_contract_termin' as any, {
				filter: { project_contract_id: { _in: contractIds } },
				fields: ['id', 'project_contract_id', 'urutan', 'label', 'status', 'b2b_linked_payables'],
				limit: -1
			})
		)) as any[];
		const terminsLinked = termins.filter((t) => Array.isArray(t.b2b_linked_payables) && t.b2b_linked_payables.length > 0);
		if (!terminsLinked.length) return [];

		// 3) Kumpulkan payable_id per tipe, fetch HANYA id+b2b_hold_status (TANPA nominal/nama) — koleksi TERPISAH.
		const piIds = new Set<string>();
		const bmIds = new Set<string>();
		for (const t of terminsLinked) {
			for (const link of t.b2b_linked_payables as any[]) {
				if (link.payable_type === 'PURCHASE_INVOICE') piIds.add(String(link.payable_id));
				else if (link.payable_type === 'BORONGAN_TERMIN') bmIds.add(String(link.payable_id));
			}
		}

		const holdStatusById = new Map<string, B2BHoldStatus>();
		if (piIds.size > 0) {
			const piRows = (await directus.request(
				readItems('purchase_invoices' as any, {
					filter: { id: { _in: Array.from(piIds) } },
					fields: ['id', 'b2b_hold_status'],
					limit: -1
				})
			)) as any[];
			for (const r of piRows) holdStatusById.set(`PI:${r.id}`, r.b2b_hold_status || null);
		}
		if (bmIds.size > 0) {
			const bmRows = (await directus.request(
				readItems('manpower_borongan_termin' as any, {
					filter: { id: { _in: Array.from(bmIds) } },
					fields: ['id', 'b2b_hold_status'],
					limit: -1
				})
			)) as any[];
			for (const r of bmRows) holdStatusById.set(`BM:${r.id}`, r.b2b_hold_status || null);
		}

		// 4) Rakit baris hasil — label generik saja (apa adanya yg tersimpan saat link, bukan nama vendor).
		const rows: B2BTerminStatusRow[] = [];
		for (const t of terminsLinked) {
			const meta = contractMeta.get(String(t.project_contract_id ? resolveId(t.project_contract_id) : ''));
			const contractId = resolveId(t.project_contract_id);
			const cm = contractMeta.get(String(contractId));
			if (!cm) continue;
			const projectName = projectNameById.get(String(cm.projectId)) || '';

			const items: B2BLinkedItem[] = (t.b2b_linked_payables as any[]).map((link) => {
				const key = link.payable_type === 'PURCHASE_INVOICE' ? `PI:${link.payable_id}` : `BM:${link.payable_id}`;
				return {
					payable_type: link.payable_type,
					label: link.label || (link.payable_type === 'PURCHASE_INVOICE' ? 'Tagihan Vendor' : 'Termin Pemborong'),
					hold_status: holdStatusById.get(key) ?? null
				};
			});

			rows.push({
				project_id: cm.projectId as any,
				project_name: projectName,
				contract_id: contractId as any,
				b2b_mode: cm.b2bMode,
				termin_id: t.id,
				termin_label: t.label || `Termin ke-${t.urutan}`,
				urutan: t.urutan,
				termin_status: t.status,
				items,
				waitingCount: items.filter((i) => i.hold_status === 'waiting_client').length,
				partialCount: items.filter((i) => i.hold_status === 'partial_released').length,
				releasedCount: items.filter((i) => i.hold_status === 'released').length
			});
		}

		return rows.sort((a, b) => Number(a.urutan) - Number(b.urutan));
	} catch (err) {
		console.warn('[b2bStatusApi] gagal memuat status B2B (fail-soft, dianggap tidak ada):', err);
		return [];
	}
}
