import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { findKasbonById } from '$lib/server/ess/kasbon';
import { assertCanApproveKasbonTahap1 } from '$lib/server/ess/divisi';
import { mirrorLegacyDecision } from '$lib/server/approvalMirror';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const id = event.params.id;

	const target = await findKasbonById(id!);
	if (!target) throw error(404, 'Pengajuan kasbon tidak ditemukan.');
	if (target.status !== 'Diajukan') throw error(409, 'Pengajuan ini sudah diproses.');

	// Fase 2 (Q3, T5): kepala divisi/unit (atau delegasi/eskalasi HRD >24 jam), bukan lagi rekan sejawat.
	await assertCanApproveKasbonTahap1(
		karyawan.id,
		karyawan.divisi,
		target.karyawan_id,
		target.tanggal_pengajuan,
		'Tidak bisa menyetujui pengajuan kasbon sendiri.'
	);

	// Atasan (ESS) hanya tahap pertama — lanjut ke HRD & Finance di admin (Fase 3, keputusan user:
	// rantai Atasan -> HRD -> Finance). Belum mengubah payment_status/dipotong dari gaji.
	const payload = {
		status: 'Disetujui Atasan',
		approver_atasan_id: String(karyawan.id),
		approver_atasan_at: new Date().toISOString()
	};

	const result = await directusServerJson(`/items/kasbon/${id}`, {
		method: 'PATCH',
		body: JSON.stringify(payload)
	});

	try {
		await mirrorLegacyDecision({
			sourceCollection: 'kasbon',
			sourceId: id!,
			moduleKey: 'hrd.kasbon',
			action: 'approve',
			actorKaryawanId: karyawan.id
		});
	} catch (e) {
		console.warn('[approvalMirror] gagal mirror approve kasbon:', e);
	}

	return json({ record: result?.data ?? result });
};
