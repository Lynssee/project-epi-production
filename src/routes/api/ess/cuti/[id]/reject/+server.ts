import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { findCutiById } from '$lib/server/ess/cuti';
import { assertCanApprove } from '$lib/server/ess/divisi';
import { mirrorLegacyDecision } from '$lib/server/approvalMirror';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const id = event.params.id;

	const target = await findCutiById(id!);
	if (!target) throw error(404, 'Pengajuan cuti tidak ditemukan.');
	if (target.status !== 'Diajukan') throw error(409, 'Pengajuan ini sudah diproses.');

	await assertCanApprove(karyawan.id, karyawan.divisi, target.karyawan_id, 'Tidak bisa menolak pengajuan cuti sendiri.');

	const body = await event.request.json().catch(() => null);
	const alasan = body?.alasan ? String(body.alasan).trim() : '';
	if (!alasan) throw error(400, 'Alasan penolakan wajib diisi.');

	const payload = {
		status: 'Ditolak',
		approver_id: String(karyawan.id),
		approved_at: new Date().toISOString(),
		disetujui_oleh: karyawan.nama_karyawan,
		catatan_hr: alasan
	};

	const result = await directusServerJson(`/items/cuti_karyawan/${id}`, {
		method: 'PATCH',
		body: JSON.stringify(payload)
	});

	try {
		await mirrorLegacyDecision({
			sourceCollection: 'cuti_karyawan',
			sourceId: id!,
			moduleKey: 'hrd.cuti',
			action: 'reject',
			actorKaryawanId: karyawan.id,
			note: alasan
		});
	} catch (e) {
		console.warn('[approvalMirror] gagal mirror reject cuti:', e);
	}

	return json({ record: result?.data ?? result });
};
