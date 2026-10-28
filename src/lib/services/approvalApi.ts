// src/lib/services/approvalApi.ts
// Klien untuk mengajukan Universal Approval Engine dari dashboard lapangan.
// Hanya submit (terbitkan approval_requests) — keputusan approve/reject
// tetap ditangani dari dashboard admin erp-epi-1. Lihat
// src/lib/server/approvalSubmit.ts (server) dan project-universal-approval-engine memory.

import { getIdToken } from './secureDirectus';

interface SubmitApprovalParams {
	moduleKey: string;
	sourceCollection: string;
	sourceId: string | number;
	title?: string;
	summary?: string | null;
	amount?: number;
	departmentKey?: string;
	callbackUrl?: string;
	payload?: Record<string, any>;
}

/** Terbitkan permintaan approval baru untuk sebuah record modul. Best-effort — bungkus dengan try/catch. */
export async function submitApprovalRequest(params: SubmitApprovalParams) {
	const token = await getIdToken();
	const res = await fetch('/api/approval/submit', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`
		},
		body: JSON.stringify(params)
	});
	const text = await res.text();
	let parsed: any = null;
	try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
	if (!res.ok) {
		throw new Error(parsed?.message || `Request gagal (${res.status})`);
	}
	return parsed;
}
