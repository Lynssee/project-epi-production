// src/lib/server/sjGerbangErpGate.ts
// SJH-12 §4.2 — gate titik "gerbang" dievaluasi mesin gate erp-epi (satu sumber aturan), dipanggil
// SERVER-KE-SERVER lewat jembatan yang sudah ada: ERP_EPI1_BASE_URL + AUTOMATION_SERVER_SECRET
// (header x-automation-secret). Tidak ada env baru.
//
// FAIL-SAFE (Aturan #3/#6): bila erp-epi tidak terkonfigurasi / tidak terjangkau dalam 3 detik / error,
// gerbang TIDAK dikunci — hasilnya `tidak_terhubung`, dicatat ke security_checklist.gate_check supaya
// admin bisa meninjau. Gerbang tidak boleh lumpuh karena server admin down.

import { env } from '$env/dynamic/private';

export type ErpGateStatus = 'ok' | 'diblokir' | 'tidak_terhubung';
export type ErpGateBlocker = { code: 'GATE'; message: string; who: 'Admin Logistik'; gate_key: string };
export type ErpGateResult = { status: ErpGateStatus; blockers: ErpGateBlocker[] };

// G_SJ_BARANG_BERMASALAH sudah dicek langsung (lebih cepat & tak bergantung jaringan) di sjGerbangGuard.
const SKIP_GATES = new Set(['G_SJ_BARANG_BERMASALAH']);

/** Murni: petakan respons gate-check erp-epi menjadi blocker untuk satpam. */
export function mapErpGateBlockers(resp: any): ErpGateBlocker[] {
	const rows: any[] = Array.isArray(resp?.blocking) ? resp.blocking : [];
	return rows
		.filter((g) => g?.gate_key && !SKIP_GATES.has(String(g.gate_key)))
		.map((g) => ({
			code: 'GATE' as const,
			gate_key: String(g.gate_key),
			message: `${g.label || g.gate_key}: ${g.message || 'belum terpenuhi'}`,
			who: 'Admin Logistik' as const
		}));
}

export async function checkErpGerbangGates(
	sjId: number | string,
	opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<ErpGateResult> {
	const base = env.ERP_EPI1_BASE_URL;
	const secret = env.AUTOMATION_SERVER_SECRET;
	if (!base || !secret) return { status: 'tidak_terhubung', blockers: [] };

	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 3000);
	try {
		const res = await (opts.fetchImpl ?? fetch)(
			`${base.replace(/\/$/, '')}/api/surat-jalan/${encodeURIComponent(String(sjId))}/gate-check?point=gerbang`,
			{ headers: { 'x-automation-secret': secret }, signal: ctrl.signal }
		);
		if (!res.ok) {
			console.error('[sjGerbangErpGate] erp-epi menjawab HTTP', res.status, '— gerbang tidak dikunci');
			return { status: 'tidak_terhubung', blockers: [] };
		}
		const blockers = mapErpGateBlockers(await res.json());
		return { status: blockers.length ? 'diblokir' : 'ok', blockers };
	} catch (e) {
		console.error('[sjGerbangErpGate] gagal menghubungi erp-epi — gerbang tidak dikunci:', e instanceof Error ? e.message : e);
		return { status: 'tidak_terhubung', blockers: [] };
	} finally {
		clearTimeout(timer);
	}
}
