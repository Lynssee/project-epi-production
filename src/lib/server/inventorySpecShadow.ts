// src/lib/server/inventorySpecShadow.ts
// Inventory 360° Fase 4 — laporkan dokumen lapangan yang BARU disimpan ke evaluator gate G_INV_SPEC_* di erp-epi
// (mode SHADOW: hanya dicatat ke gate_audit_log, TIDAK PERNAH menahan dokumen). Relay server-ke-server, pola sama
// projectNotify.ts: evaluator, gate_definitions, dan gate_audit_log hanya dikelola di erp-epi.
//
// Fire-and-forget & fail-soft: kegagalan dicatat jelas di log server tetapi tidak boleh menggagalkan alur lapangan.

import { env } from '$env/dynamic/private';

export type SpecShadowKind = 'purchase' | 'receive' | 'training';

export function reportInventorySpecShadow(p: {
	kind: SpecShadowKind;
	collection: string;
	recordId: string | number;
	itemIds: Array<number | string | null | undefined>;
	userEmail?: string | null;
	/** Wajib untuk kind 'training' (kelulusan peminta dinilai server erp-epi). */
	karyawanId?: number | null;
}): void {
	const ids = [...new Set(p.itemIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
	if (!ids.length) return;
	const baseUrl = env.ERP_EPI1_BASE_URL;
	const secret = env.AUTOMATION_SERVER_SECRET;
	if (!baseUrl || !secret) {
		console.warn('[inventorySpecShadow] ERP_EPI1_BASE_URL/AUTOMATION_SERVER_SECRET belum dikonfigurasi — evaluasi gate shadow dilewati.');
		return;
	}
	fetch(`${baseUrl.replace(/\/$/, '')}/api/automation/inventory-spec-shadow`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'x-automation-secret': secret },
		body: JSON.stringify({ kind: p.kind, collection: p.collection, recordId: String(p.recordId), itemIds: ids, userEmail: p.userEmail ?? null, karyawanId: p.karyawanId ?? null })
	})
		.then((res) => {
			if (!res.ok) console.error(`[inventorySpecShadow] erp-epi membalas HTTP ${res.status} (diabaikan).`);
		})
		.catch((e) => console.error('[inventorySpecShadow] gagal menghubungi erp-epi (diabaikan):', e?.message || e));
}
