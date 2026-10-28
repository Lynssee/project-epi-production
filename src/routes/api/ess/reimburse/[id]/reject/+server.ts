import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { findReimburseById } from '$lib/server/ess/reimburse';
import { assertCanApprove } from '$lib/server/ess/divisi';
import { mirrorLegacyDecision } from '$lib/server/approvalMirror';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const id = event.params.id;

	const target = await findReimburseById(id!);
	if (!target) throw error(404, 'Klaim reimbursement tidak ditemukan.');
	if (target.status !== 'Diajukan') throw error(409, 'Klaim ini sudah diproses.');

	await assertCanApprove(karyawan.id, karyawan.divisi, target.karyawan_id, 'Tidak bisa menolak klaim sendiri.');

	const body = await event.request.json().catch(() => null);
	const alasan = body?.alasan ? String(body.alasan).trim() : '';
	if (!alasan) throw error(400, 'Alasan penolakan wajib diisi.');

	const payload = {
		status: 'Ditolak',
		approver_id: String(karyawan.id),
		approved_at: new Date().toISOString(),
		catatan: alasan
	};

	const result = await directusServerJson(`/items/klaim_reimbursement/${id}`, {
		method: 'PATCH',
		body: JSON.stringify(payload)
	});

	try {
		await mirrorLegacyDecision({
			sourceCollection: 'klaim_reimbursement',
			sourceId: id!,
			moduleKey: 'hrd.reimburse',
			action: 'reject',
			actorKaryawanId: karyawan.id,
			note: alasan
		});
	} catch (e) {
		console.warn('[approvalMirror] gagal mirror reject reimburse:', e);
	}

	return json({ record: result?.data ?? result });
};
