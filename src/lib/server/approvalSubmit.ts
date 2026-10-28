// src/lib/server/approvalSubmit.ts
// SERVER-ONLY. Subset dari Universal Approval Engine (erp-epi-1
// src/lib/server/approvalEngine.js) yang dibutuhkan project-epi: hanya
// MENERBITKAN approval_requests baru (submit-mirror), bukan memutuskannya.
// Keputusan (approve/reject/inbox) tetap di dashboard admin erp-epi-1 —
// kedua app berbagi Directus instance yang sama jadi cukup menulis ke
// koleksi approval_requests yang sama, tanpa panggilan cross-app.

import { env } from '$env/dynamic/private';
import { directusServerJson } from './directus';

export function resolveApprovalCallbackUrl(url?: string | null): string | null {
	if (!url) return null;
	const base = env.ERP_EPI1_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://internal.eltamaprimaindo.com' : 'http://localhost:9390');
	const cleanBase = base.replace(/\/+$/, '');
	if (url.startsWith('/')) {
		return `${cleanBase}${url}`;
	}
	if (url.startsWith('https://internal.eltamaprimaindo.com') && cleanBase !== 'https://internal.eltamaprimaindo.com') {
		return url.replace('https://internal.eltamaprimaindo.com', cleanBase);
	}
	return url;
}

async function logProcessEventServer({ process, instanceId, stage, meta }: {
	process: string; instanceId: string | number; stage: string; meta?: Record<string, any>;
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
		console.warn('[approvalSubmit] logProcessEvent gagal (diabaikan):', e?.message || e);
	}
}

/** Cari karyawan lewat firebase_uid (jembatan identitas Lapangan <-> Admin). */
export async function getKaryawanByFirebaseUid(uid: string) {
	const filter = encodeURIComponent(JSON.stringify({ firebase_uid: { _eq: uid } }));
	// Aturan #3: Directus fetching must be separated for each relation.
	// Query kolom flat saja dari koleksi karyawan (tanpa nested jabatan_id.nama_posisi).
	const data = await directusServerJson(
		`/items/karyawan?filter=${filter}&fields=id,nama_karyawan,divisi,jabatan_id&limit=1`
	);
	const karyawan = data?.data?.[0];
	if (!karyawan) return null;

	// Query terpisah untuk relasi posisi bila jabatan_id ada
	const jId = typeof karyawan.jabatan_id === 'object' ? karyawan.jabatan_id?.id : karyawan.jabatan_id;
	if (jId) {
		try {
			const posData = await directusServerJson(`/items/posisi/${jId}?fields=id,nama_posisi`);
			if (posData?.data) {
				karyawan.jabatan_id = {
					id: posData.data.id,
					nama_posisi: posData.data.nama_posisi
				};
			}
		} catch (e: any) {
			console.warn('[approvalSubmit] gagal fetch posisi terpisah:', e?.message || e);
		}
	}

	return karyawan;
}

async function fetchActiveWorkflowForModule(moduleKey: string) {
	const wfFilter = encodeURIComponent(
		JSON.stringify({ _and: [{ module_key: { _eq: moduleKey } }, { is_active: { _eq: true } }] })
	);
	const wfData = await directusServerJson(`/items/approval_workflows?filter=${wfFilter}&limit=1&fields=id`);
	return wfData?.data?.[0] || null;
}

/** Terbitkan permintaan approval baru. Dipanggil modul bisnis saat record diajukan. */
export async function createApprovalRequest({
	moduleKey,
	sourceCollection,
	sourceId,
	title,
	summary,
	amount,
	departmentKey,
	requesterId,
	callbackUrl,
	payload
}: {
	moduleKey: string; sourceCollection: string; sourceId: string | number;
	title?: string; summary?: string; amount?: number; departmentKey?: string;
	requesterId: number; callbackUrl?: string; payload?: Record<string, any>;
}) {
	if (!moduleKey || !sourceCollection || !sourceId) {
		throw new Error('module_key, source_collection, dan source_id wajib diisi');
	}

	const workflow = await fetchActiveWorkflowForModule(moduleKey);

	const created = await directusServerJson('/items/approval_requests', {
		method: 'POST',
		body: JSON.stringify({
			module_key: moduleKey,
			source_collection: sourceCollection,
			source_id: String(sourceId),
			title: title || null,
			summary: summary || null,
			amount: amount ?? null,
			department_key: departmentKey || null,
			requester_id: requesterId || null,
			current_step: 1,
			status: 'pending',
			callback_url: resolveApprovalCallbackUrl(callbackUrl),
			payload: payload || null,
			workflow_id: workflow?.id || null
		})
	});

	if (created?.data?.id) {
		const meta = { module_key: moduleKey, department_key: departmentKey || null };
		logProcessEventServer({ process: 'APPROVAL_SLA', instanceId: created.data.id, stage: 'masuk_antrean', meta });
		logProcessEventServer({ process: 'APPROVAL_SLA', instanceId: created.data.id, stage: 'diajukan', meta });
	}

	return created?.data;
}
