import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { findLemburById } from '$lib/server/ess/lembur';
import { assertCanApproveLemburStep1 } from '$lib/server/ess/divisi';
import { retractBridgeRecord } from '$lib/server/ess/absensiLemburBridge';
import { mirrorLegacyDecision } from '$lib/server/approvalMirror';
import { notifyRejected } from '$lib/server/ess/lemburNotify';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const id = event.params.id;

	const target = await findLemburById(id!);
	if (!target) throw error(404, 'Pengajuan lembur tidak ditemukan.');
	// Diajukan -> ditolak normal. Disetujui -> ditolak = pembatalan (mis. salah approve),
	// wajib menarik kembali bridge absensi_lembur agar tidak salah dibayar payroll.
	if (target.status !== 'Diajukan' && target.status !== 'Disetujui') {
		throw error(409, 'Pengajuan ini sudah diproses.');
	}
	const wasApproved = target.status === 'Disetujui';
	// P4: pengajuan yang sudah lewat step-1 (atasan/divisi) tapi belum final (masih menunggu
	// eskalasi HRD) — batalkan juga penanda step-1-nya, supaya tidak nyangkut "menunggu HRD"
	// selamanya untuk pengajuan yang sudah ditolak.
	const wasStep1Pending = target.status === 'Diajukan' && !!target.atasan_approver_id;

	await assertCanApproveLemburStep1(karyawan.id, karyawan.divisi, target.karyawan_id, 'Tidak bisa menolak pengajuan lembur sendiri.');

	const body = await event.request.json().catch(() => null);
	const alasan = body?.alasan ? String(body.alasan).trim() : '';
	if (!alasan) throw error(400, 'Alasan penolakan wajib diisi.');

	const payload = {
		status: 'Ditolak',
		approver_id: String(karyawan.id),
		approved_at: new Date().toISOString(),
		catatan_approval: alasan,
		...(wasStep1Pending ? { atasan_approver_id: null, disetujui_atasan_at: null } : {})
	};

	const result = await directusServerJson(`/items/ess_lembur/${id}`, {
		method: 'PATCH',
		body: JSON.stringify(payload)
	});

	if (wasApproved) {
		try {
			await retractBridgeRecord(id!);
		} catch (e) {
			console.error('[absensiLemburBridge] Gagal menarik bridge absensi_lembur saat pembatalan:', e);
		}
	}

	try {
		await mirrorLegacyDecision({
			sourceCollection: 'ess_lembur',
			sourceId: id!,
			moduleKey: 'hrd.lembur',
			action: 'reject',
			actorKaryawanId: karyawan.id,
			note: alasan
		});
	} catch (e) {
		console.warn('[approvalMirror] gagal mirror reject lembur:', e);
	}

	// Notifikasi WA hasil ke karyawan (P5).
	await notifyRejected(target, alasan, karyawan.nama_karyawan);

	return json({ record: result?.data ?? result });
};

