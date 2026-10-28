// src/routes/api/pengajuan-anggaran-submit-approval/+server.ts
// Pendaftaran pengajuan_anggaran ke Approval Engine (approval_requests)
// LANGSUNG ke Directus instance bersama, tanpa ketergantungan HTTP cross-app.
//
// Alur:
// 1. Verifikasi user Firebase yang memanggil
// 2. Resolve karyawan (requester_id) dan department_key
// 3. Tentukan tier workflow berdasarkan totalAmount:
//    - <= 5jt  : finance.budget (T1)
//    - <= 50jt : finance.budget.manager (T2)
//    - > 50jt  : finance.budget.direktur (T3)
// 4. Buat / pastikan baris approval_requests di Directus
// 5. Update approval_request_id dan pengaju_id pada record pengajuan_anggaran

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';

async function logProcessEventServer({
	process,
	instanceId,
	stage,
	meta
}: {
	process: string;
	instanceId: string | number;
	stage: string;
	meta?: Record<string, any>;
}) {
	try {
		await directusServerJson('/items/process_event_log', {
			method: 'POST',
			body: JSON.stringify({
				process_code: process,
				instance_id: String(instanceId),
				instance_ref: `approval_requests:${instanceId}`,
				stage_key: stage,
				event_ts: new Date().toISOString(),
				source: 'live',
				meta: meta || null
			})
		});
	} catch (e: any) {
		console.warn('[submit-approval] logProcessEvent gagal (diabaikan):', e?.message || e);
	}
}

export async function POST(event: RequestEvent) {
	const user = await requireUser(event);

	const body = await event.request.json().catch(() => ({}));
	const { pengajuanId, nomorPengajuan, totalAmount, departmentKey, summary, requesterId } = body;

	if (!pengajuanId) {
		throw error(400, 'pengajuanId wajib diisi');
	}

	try {
		// 1. Resolve identitas karyawan (requester_id)
		let finalRequesterId = Number(requesterId) || null;
		let finalDepartmentKey = departmentKey || null;

		if (!finalRequesterId) {
			try {
				const email = user.email;
				const uid = user.localId;
				let filter: any = null;
				if (uid && email) {
					filter = {
						_or: [
							{ firebase_uid: { _eq: uid } },
							{ email_company: { _eq: email } },
							{ login_email: { _eq: email } }
						]
					};
				} else if (email) {
					filter = {
						_or: [
							{ email_company: { _eq: email } },
							{ login_email: { _eq: email } }
						]
					};
				} else if (uid) {
					filter = { firebase_uid: { _eq: uid } };
				}

				if (filter) {
					const kRes = await directusServerJson<{ data: Array<{ id: number; divisi?: string }> }>(
						`/items/karyawan?filter=${encodeURIComponent(JSON.stringify(filter))}&fields=id,divisi&limit=1`
					);
					const k = kRes?.data?.[0];
					if (k) {
						finalRequesterId = k.id;
						if (!finalDepartmentKey && k.divisi) {
							finalDepartmentKey = k.divisi;
						}
					}
				}
			} catch (err: any) {
				console.warn('[submit-approval] Gagal resolve karyawan pemohon:', err?.message);
			}
		}

		// 2. Tentukan tier module_key & ambil workflow aktif
		const amount = Number(totalAmount) || 0;
		let moduleKey = 'finance.budget';
		if (amount > 50_000_000) {
			moduleKey = 'finance.budget.direktur';
		} else if (amount > 5_000_000) {
			moduleKey = 'finance.budget.manager';
		}

		const wfFilter = encodeURIComponent(
			JSON.stringify({ _and: [{ module_key: { _eq: moduleKey } }, { is_active: { _eq: true } }] })
		);
		const wfData = await directusServerJson<{ data: Array<{ id: string }> }>(
			`/items/approval_workflows?filter=${wfFilter}&limit=1&fields=id`
		);
		const workflowId = wfData?.data?.[0]?.id || null;

		// 3. Cek apakah approval_requests untuk pengajuan ini sudah ada (idempotensi)
		const existingFilter = encodeURIComponent(
			JSON.stringify({
				_and: [
					{ source_collection: { _eq: 'pengajuan_anggaran' } },
					{ source_id: { _eq: String(pengajuanId) } }
				]
			})
		);
		const existing = await directusServerJson<{ data: Array<{ id: string }> }>(
			`/items/approval_requests?filter=${existingFilter}&limit=1&fields=id`
		);
		let approvalRequestId = existing?.data?.[0]?.id || null;

		// 4. Jika belum ada, buat approval_requests baru di Directus
		if (!approvalRequestId) {
			const title = `Pengajuan Anggaran ${nomorPengajuan || `#${pengajuanId}`}`;
			const createRes = await directusServerJson<{ data: { id: string } }>('/items/approval_requests', {
				method: 'POST',
				body: JSON.stringify({
					module_key: moduleKey,
					source_collection: 'pengajuan_anggaran',
					source_id: String(pengajuanId),
					title,
					summary: summary || null,
					amount,
					department_key: finalDepartmentKey || 'PROJECT',
					requester_id: finalRequesterId || null,
					current_step: 1,
					status: 'pending',
					callback_url: `${(env.ERP_EPI1_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://internal.eltamaprimaindo.com' : 'http://localhost:9390')).replace(/\/+$/, '')}/api/pengajuan-anggaran/approval-callback`,
					workflow_id: workflowId
				})
			});
			approvalRequestId = createRes?.data?.id || null;

			if (approvalRequestId) {
				const meta = { module_key: moduleKey, department_key: finalDepartmentKey || 'PROJECT' };
				logProcessEventServer({ process: 'APPROVAL_SLA', instanceId: approvalRequestId, stage: 'masuk_antrean', meta });
				logProcessEventServer({ process: 'APPROVAL_SLA', instanceId: approvalRequestId, stage: 'diajukan', meta });
			}
		}

		// 5. Tautkan approval_request_id dan pengaju_id kembali ke pengajuan_anggaran
		if (approvalRequestId) {
			const patchData: Record<string, any> = {
				approval_request_id: approvalRequestId
			};
			if (finalRequesterId) {
				patchData.pengaju_id = finalRequesterId;
			}
			await directusServerJson(`/items/pengajuan_anggaran/${pengajuanId}`, {
				method: 'PATCH',
				body: JSON.stringify(patchData)
			}).catch((patchErr: any) => {
				console.warn(`[submit-approval] Gagal patch pengajuan_anggaran #${pengajuanId}:`, patchErr?.message);
			});
		}

		return json({
			success: true,
			data: {
				id: approvalRequestId,
				approval_request_id: approvalRequestId,
				module_key: moduleKey,
				workflow_id: workflowId
			}
		});
	} catch (e: any) {
		console.error('[pengajuan-anggaran-submit-approval] Gagal mendaftarkan approval:', e?.message || e);
		throw error(500, e?.message || 'Gagal mendaftarkan pengajuan ke Approval Engine');
	}
}

export async function GET() {
	throw error(405, 'Gunakan POST');
}
