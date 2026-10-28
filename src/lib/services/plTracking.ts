// src/lib/services/plTracking.ts
// PL Tracking Pipeline v2, Fase 4b — klien tipis ke plChain.js di erp-epi
// (server-only di sana). Sama pola dengan materialChain.ts: fetch cross-origin ke
// admin app pakai Bearer token Firebase yang sama. Tidak menghitung ulang apa pun —
// murni pass-through + tipe.

import { getIdToken } from './secureDirectus';

const ADMIN_APP_ORIGIN = '';

export type PlStageState = 'done' | 'current' | 'pending';

export interface PlTimelineStage {
	key: string;
	label: string;
	state: PlStageState;
	ts: string | null;
	/** false + state 'done' => "belum tercatat" (lubang data, bukan "belum terjadi"). */
	recorded: boolean;
	actor: string | null;
}

export interface PlTimelineDoc {
	type: 'PR' | 'PO' | 'INVOICE' | 'SJ';
	id: number | null;
	number: string | null;
	status: string | null;
}

export interface PlEta {
	date: string | null;
	source: 'tanggal_kirim_po' | 'rata_rata_histori' | 'perkiraan_default';
}

export interface PlTimeline {
	budgetId: number;
	itemId: number | null;
	itemName: string | null;
	itemLinked: boolean;
	path: 'cepat' | 'pengadaan';
	currentStageKey: string;
	currentStageLabel: string;
	tracked: boolean;
	eta: PlEta | null;
	linkedDocs: PlTimelineDoc[];
	/** Fase 2 (rencana v2 "PL -> Multi Surat Jalan + Pergantian Barang", 23 Sep 2026) -- label sisa kirim. */
	qty: number | null;
	qtySudahDikirim: number | null;
	satuan: string | null;
	stages: PlTimelineStage[];
}

export interface PlTrackingSummary {
	projectId: number | string;
	total: number;
	byStage: Record<string, number>;
	unlinkedCount: number;
}

const ETA_SOURCE_LABEL: Record<string, string> = {
	tanggal_kirim_po: 'tanggal kirim PO',
	rata_rata_histori: 'rata-rata histori',
	perkiraan_default: 'perkiraan default'
};
export function etaSourceLabel(source: string | null | undefined): string {
	return (source && ETA_SOURCE_LABEL[source]) || 'perkiraan';
}

async function callCrossDept(scope: string, params: Record<string, string> = {}): Promise<any | null> {
	try {
		const token = await getIdToken();
		const qs = new URLSearchParams(params).toString();
		const res = await fetch(`${ADMIN_APP_ORIGIN}/api/cross-dept/${scope}${qs ? `?${qs}` : ''}`, {
			headers: { Authorization: `Bearer ${token}` }
		});
		if (!res.ok) {
			console.warn(`[plTracking] cross-dept ${scope} gagal (${res.status})`);
			return null;
		}
		const body = await res.json();
		return body?.data ?? null;
	} catch (err) {
		console.warn(`[plTracking] cross-dept ${scope} error:`, err);
		return null;
	}
}

/** Timeline lengkap satu baris permintaan (project_budgets.id). */
export async function fetchPlTimeline(budgetId: number): Promise<PlTimeline | null> {
	const data = await callCrossDept('pl-tracking', { budget_id: String(budgetId) });
	return (data?.timeline as PlTimeline) ?? null;
}

/** Ringkasan byStage untuk KPI daftar (per proyek). */
export async function fetchPlTrackingSummary(projectId: number): Promise<PlTrackingSummary | null> {
	const data = await callCrossDept('pl-tracking', { project_id: String(projectId) });
	if (!data) return null;
	return {
		projectId: data.projectId,
		total: data.total || 0,
		byStage: data.byStage || {},
		unlinkedCount: data.unlinkedCount || 0
	};
}
