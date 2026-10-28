// src/lib/server/approvalMirror.ts
// Mirror/audit best-effort ke Universal Approval Engine (koleksi approval_* di
// Directus, dibangun & dimiliki oleh erp-epi-1 — lihat
// Rencana-Implementasi-Approval-Management-EPI). project-epi (ESS lapangan)
// menulis LANGSUNG ke Directus lewat token server sendiri (directusServerJson),
// tidak perlu HTTP call lintas app.
//
// PENTING: modul ini TIDAK memberi/mencabut wewenang approve apa pun — otorisasi
// ESS (assertCanApprove, guard status Diajukan) tetap sepenuhnya di jalur lama,
// tidak diubah. Ini murni pencatatan paralel supaya cuti/lembur/reimburse tampil
// di Inbox & Riwayat terpusat /approval (erp-epi-1). Pemanggil WAJIB membungkus
// panggilan fungsi di sini dengan try/catch agar kegagalan mirror tidak pernah
// menggagalkan approve/reject/submit yang asli.

import { directusServerJson } from './directus';

export async function mirrorSubmitApprovalRequest(params: {
	moduleKey: string;
	sourceCollection: string;
	sourceId: string | number;
	title?: string | null;
	summary?: string | null;
	amount?: number | null;
	departmentKey?: string | null;
	requesterId: number | string;
}) {
	await directusServerJson('/items/approval_requests', {
		method: 'POST',
		body: JSON.stringify({
			module_key: params.moduleKey,
			source_collection: params.sourceCollection,
			source_id: String(params.sourceId),
			title: params.title || null,
			summary: params.summary || null,
			amount: params.amount ?? null,
			department_key: params.departmentKey || null,
			requester_id: Number(params.requesterId),
			current_step: 1,
			status: 'pending'
		})
	});
}

/**
 * FASE 3 (Rencana Self-Service PL v2 — Bongkar Approval Theater). Kebijakan apakah
 * checklist GA membuat approval_requests. Dibaca dari app_settings module='ga_checklist':
 *   - exception_only (bool, default true): checklist normal TIDAK bikin approval.
 *   - approval_min_score (number, default 100): skor di bawah ini dianggap menyimpang.
 * Cache in-memory 5 menit — dipanggil per submit checklist. Default aman bila baris kosong.
 */
let _gaPolicyCache: { at: number; value: { exceptionOnly: boolean; minScore: number } } | null = null;
export async function getGaChecklistApprovalPolicy(): Promise<{ exceptionOnly: boolean; minScore: number }> {
	if (_gaPolicyCache && Date.now() - _gaPolicyCache.at < 300_000) return _gaPolicyCache.value;
	const value = { exceptionOnly: true, minScore: 100 };
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/app_settings?filter[module][_eq]=ga_checklist&fields=setting_key,setting_value&limit=-1`
		);
		for (const row of res?.data || []) {
			if (row.setting_key === 'exception_only') {
				value.exceptionOnly = !(row.setting_value === 'false' || row.setting_value === false || row.setting_value === '0');
			} else if (row.setting_key === 'approval_min_score') {
				const n = Number(row.setting_value);
				if (Number.isFinite(n)) value.minScore = n;
			}
		}
	} catch {
		/* pakai default */
	}
	_gaPolicyCache = { at: Date.now(), value };
	return value;
}

export async function mirrorLegacyDecision(params: {
	sourceCollection: string;
	sourceId: string | number;
	moduleKey: string;
	action: 'approve' | 'reject' | 'return';
	actorKaryawanId: number | string;
	note?: string | null;
}) {
	const filter = encodeURIComponent(
		JSON.stringify({
			_and: [
				{ source_collection: { _eq: params.sourceCollection } },
				{ source_id: { _eq: String(params.sourceId) } },
				{ module_key: { _eq: params.moduleKey } },
				{ status: { _eq: 'pending' } }
			]
		})
	);
	const found = await directusServerJson(`/items/approval_requests?filter=${filter}&limit=1&fields=id`);
	const request = found?.data?.[0];
	if (!request) return; // tidak ada baris mesin untuk record ini (mis. dibuat sebelum mirror dipasang)

	const nextStatus = params.action === 'approve' ? 'approved' : params.action === 'reject' ? 'rejected' : 'returned';

	await directusServerJson(`/items/approval_requests/${request.id}`, {
		method: 'PATCH',
		body: JSON.stringify({ status: nextStatus })
	});

	await directusServerJson('/items/approval_actions', {
		method: 'POST',
		body: JSON.stringify({
			request_id: request.id,
			actor_id: Number(params.actorKaryawanId),
			action: params.action,
			note: params.note || null
		})
	});
}
