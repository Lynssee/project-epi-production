// src/lib/services/wsTimelineStatus.ts
// Sinkronisasi Laporan Harian Workshop v2, Fase 5 — klien tipis ke scope cross-dept
// 'ws-timeline-status' (erp-epi). Sama pola dengan plTracking.ts/materialChain.ts:
// fetch cross-origin ke admin app pakai Bearer token Firebase yang sama (satu
// Firebase project login-43e72, diverifikasi 17 Sep — token project-epi valid
// diverifikasi erp-epi tanpa exchange tambahan).
//
// TANPA RUPIAH sama sekali (filosofi RAP v2 Fase 5 existing) — endpoint sumber
// sudah tidak pernah mengirim field nominal, ini murni pass-through + tipe.

import { getIdToken } from './secureDirectus';

const ADMIN_APP_ORIGIN = '';

export type WsEvFlag = 'red' | 'yellow' | 'green' | null;

export interface WsTimelineStatus {
	projectId: number | string;
	found: boolean;
	active: boolean | null;
	progressPct: number | null;
	serapanPct: number | null;
	evFlag: WsEvFlag;
	manpowerEstimasi: boolean | null;
}

/**
 * WSK-15 §4a — lampu + % serapan untuk BANYAK PO dalam SATU request (Papan Order). Server ERP menjalankan konsolidasi workshop sekali.
 * ERP lama (belum mendukung project_ids) → respons tanpa byProject → kembalikan {} (lampu kosong), BUKAN fallback N request.
 */
export async function fetchWsTimelineStatusBatch(
	projectIds: number[],
	workshop: 'ciketing' | 'balaraja' = 'ciketing'
): Promise<Record<number, WsTimelineStatus | null>> {
	const ids = [...new Set(projectIds.filter((n) => Number.isFinite(n) && n > 0))];
	if (ids.length === 0) return {};
	try {
		const token = await getIdToken();
		const qs = new URLSearchParams({ project_ids: ids.join(','), workshop }).toString();
		const res = await fetch(`${ADMIN_APP_ORIGIN}/api/cross-dept/ws-timeline-status?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
		if (!res.ok) {
			console.warn(`[wsTimelineStatus] batch gagal (${res.status})`);
			return {};
		}
		const body = await res.json();
		const by = body?.data?.byProject;
		if (!by || typeof by !== 'object') return {}; // ERP belum mendukung batch
		const out: Record<number, WsTimelineStatus | null> = {};
		for (const id of ids) out[id] = (by[id] as WsTimelineStatus) ?? null;
		return out;
	} catch (err) {
		console.warn('[wsTimelineStatus] batch error:', err);
		return {};
	}
}

/** Kartu lampu + % serapan (tanpa rupiah) untuk satu PO workshop, dipakai /timeline. */
export async function fetchWsTimelineStatus(
	projectId: number,
	workshop: 'ciketing' | 'balaraja' = 'ciketing'
): Promise<WsTimelineStatus | null> {
	try {
		const token = await getIdToken();
		const qs = new URLSearchParams({ project_id: String(projectId), workshop }).toString();
		const res = await fetch(`${ADMIN_APP_ORIGIN}/api/cross-dept/ws-timeline-status?${qs}`, {
			headers: { Authorization: `Bearer ${token}` }
		});
		if (!res.ok) {
			console.warn(`[wsTimelineStatus] cross-dept gagal (${res.status})`);
			return null;
		}
		const body = await res.json();
		return (body?.data as WsTimelineStatus) ?? null;
	} catch (err) {
		console.warn('[wsTimelineStatus] error:', err);
		return null;
	}
}
