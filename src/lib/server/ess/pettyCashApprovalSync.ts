// src/lib/server/ess/pettyCashApprovalSync.ts
// SERVER-ONLY. PC3-09 — port `reconcilePcrApproval` dari erp-epi (src/lib/server/pettyCashApprovalSync.js):
// tiket kas kecil dari LAPANGAN kini muncul di Approval Inbox atasan dan tertutup bila diputuskan di HP / dibatalkan.
// `planApprovalSync` dijaga IDENTIK dengan admin (tes kontrak bertabel harapan yang sama).
// Hanya MENULIS approval_requests/approval_actions (koleksi bersama); keputusan Inbox dieksekusi engine admin.

import { env } from '$env/dynamic/private';
import { directusServerJson } from '$lib/server/directus';
import { createApprovalRequest } from '$lib/server/approvalSubmit';

const asId = (v: any): number | null => (v && typeof v === 'object' ? v.id : v) || null;

export type ApprovalPlan =
	| { op: 'none' | 'create' | 'reactivate' }
	| { op: 'close'; status: string; actionType: string };

/** Murni. Tentukan operasi terhadap approval_requests berdasarkan status tiket SESUDAH transisi. */
export function planApprovalSync(
	rowStatus: string,
	action: string,
	existing: { id: number; status: string } | null
): ApprovalPlan {
	if (rowStatus === 'menunggu_atasan') {
		if (!existing) return { op: 'create' };
		return existing.status === 'pending' ? { op: 'none' } : { op: 'reactivate' };
	}
	if (!existing || existing.status !== 'pending') return { op: 'none' };
	if (action === 'atasan_approve') return { op: 'close', status: 'approved', actionType: 'approve' };
	if (action === 'atasan_reject') return { op: 'close', status: 'rejected', actionType: 'reject' };
	if (action === 'atasan_revisi') return { op: 'close', status: 'returned', actionType: 'return' };
	// batal pemohon / kasir_* / finance_* / lpj_* / langsung ke kasir → item hantu ditutup, bukan "ditolak atasan"
	return { op: 'close', status: 'cancelled', actionType: 'comment' };
}

const titleOf = (row: any) => `Kas Kecil ${row.request_number || `#${row.id}`} — ${(row.description || '').slice(0, 70)}`;
const summaryOf = (row: any) =>
	`${row.mode === 'advance' ? '[UANG MUKA] ' : ''}${row.description || '-'} (Penerima: ${row.payee_name || '-'})`;

/**
 * Selaraskan approval_requests dengan status tiket SETELAH transisi sukses. Non-fatal: kegagalan dicatat,
 * tidak pernah menggagalkan transisi tiket.
 */
export async function reconcilePcrApproval(
	row: any,
	opts: { action?: string; actorKaryawanId?: number | null; note?: string } = {}
): Promise<{ op: string } | null> {
	const { action = '', actorKaryawanId = null, note = '' } = opts;
	if (!row?.id) return null;
	try {
		const sourceId = String(row.id);
		const existingRes = await directusServerJson<{ data: any[] }>(
			`/items/approval_requests?filter[source_collection][_eq]=petty_cash_requests` +
				`&filter[source_id][_eq]=${encodeURIComponent(sourceId)}&sort=-id&limit=1&fields=id,status,current_step`
		);
		const existing = existingRes?.data?.[0] || null;
		const plan = planApprovalSync(row.status, action, existing);

		if (plan.op === 'create') {
			// callbackUrl → admin (pola modul fleet/packing list). Kosong bila env belum diset: engine admin jatuh ke
			// MODULE_CALLBACK_FALLBACK['finance.petty_cash'], jadi tidak fatal.
			const base = env.ERP_EPI1_BASE_URL;
			await createApprovalRequest({
				moduleKey: 'finance.petty_cash',
				sourceCollection: 'petty_cash_requests',
				sourceId,
				title: titleOf(row),
				summary: summaryOf(row),
				amount: Number(row.amount) || 0,
				departmentKey: row.requester_divisi || undefined,
				requesterId: asId(row.requester_karyawan_id) as number,
				callbackUrl: base ? `${base.replace(/\/$/, '')}/api/petty-cash-request/approval-callback` : undefined,
				payload: {
					fund_id: asId(row.fund_id),
					request_number: row.request_number,
					mode: row.mode,
					atasan_karyawan_id: asId(row.atasan_karyawan_id)
				}
			});
		} else if (plan.op === 'reactivate') {
			await directusServerJson(`/items/approval_requests/${existing.id}`, {
				method: 'PATCH',
				body: JSON.stringify({
					status: 'pending',
					current_step: 1,
					amount: Number(row.amount) || 0,
					title: titleOf(row),
					summary: summaryOf(row)
				})
			});
		} else if (plan.op === 'close') {
			await directusServerJson('/items/approval_actions', {
				method: 'POST',
				body: JSON.stringify({
					request_id: existing.id,
					actor_id: actorKaryawanId || null,
					action: plan.actionType,
					note:
						plan.actionType === 'comment'
							? `Item ditutup: tiket kas kecil ${row.status} (aksi ${action || '-'})${note ? ` — ${note}` : ''}`
							: note || null,
					step: existing.current_step || 1
				})
			}).catch((e: any) => console.error('[pettyCashApprovalSync] gagal catat approval_actions:', e?.message || e));
			await directusServerJson(`/items/approval_requests/${existing.id}`, {
				method: 'PATCH',
				body: JSON.stringify({ status: plan.status })
			});
		}
		return { op: plan.op };
	} catch (err: any) {
		console.error(
			`[pettyCashApprovalSync] reconcile ${row?.request_number || row?.id} (${action}) gagal (diabaikan, non-fatal):`,
			err?.message || err
		);
		return null;
	}
}
