// src/lib/server/gates/gateAudit.ts
// Pencatat keputusan gate ke koleksi gate_audit_log dari sisi project-epi (dipakai G_SEC* / G_CLN*).
// Best-effort: kegagalan menulis audit tidak boleh menggagalkan transaksi utama (tapi dicatat di log).

import { directusServerJson } from '$lib/server/directus';

export type GateAuditDecision = 'shadow' | 'allow' | 'warn' | 'block';

export async function writeGateAudit(params: {
	gate: string;
	collection: string;
	recordId: number | string | null;
	decision: GateAuditDecision;
	reason: string | null;
	snapshot: Record<string, unknown>;
	email: string | null;
}): Promise<void> {
	try {
		await directusServerJson('/items/gate_audit_log', {
			method: 'POST',
			body: JSON.stringify({
				gate: params.gate,
				collection: params.collection,
				method: 'POST',
				record_id: params.recordId != null ? String(params.recordId) : null,
				decision: params.decision,
				reason: params.reason,
				payload_snapshot: params.snapshot,
				user_email: params.email
			})
		});
	} catch (err) {
		console.error(`[gateAudit] gagal menulis gate_audit_log ${params.gate} (diabaikan):`, err);
	}
}
