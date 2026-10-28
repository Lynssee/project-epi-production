import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { findLemburById } from '$lib/server/ess/lembur';
import { assertCanApproveLemburStep1, isHrdDivisi } from '$lib/server/ess/divisi';
import { syncApprovedLemburToAbsensi } from '$lib/server/ess/absensiLemburBridge';
import { mirrorLegacyDecision } from '$lib/server/approvalMirror';
import { notifyApproved } from '$lib/server/ess/lemburNotify';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const id = event.params.id;

	const target = await findLemburById(id!);
	if (!target) throw error(404, 'Pengajuan lembur tidak ditemukan.');
	if (target.status !== 'Diajukan') throw error(409, 'Pengajuan ini sudah diproses.');

	const needsEscalation = !!target.requires_hrd_approval;
	const step1Done = !!target.atasan_approver_id;

	// P4 STEP 1: lembur >4 jam/hari libur wajib eskalasi ke HRD — approval pertama (atasan/rekan
	// sedivisi) hanya menandai persetujuan awal, TIDAK mengubah status utama & TIDAK memicu
	// bridge P3/notifikasi hasil. Baru final saat HRD approve di STEP 2 di bawah.
	if (needsEscalation && !step1Done) {
		await assertCanApproveLemburStep1(
			karyawan.id,
			karyawan.divisi,
			target.karyawan_id,
			'Tidak bisa menyetujui pengajuan lembur sendiri.'
		);

		const step1Result = await directusServerJson(`/items/ess_lembur/${id}`, {
			method: 'PATCH',
			body: JSON.stringify({
				atasan_approver_id: karyawan.id,
				disetujui_atasan_at: new Date().toISOString()
			})
		});

		return json({ record: step1Result?.data ?? step1Result, status: 'MenungguApprovalHRD' });
	}

	if (needsEscalation && step1Done) {
		// STEP 2: approval final untuk lembur yang butuh eskalasi — WAJIB staf HRD, dan tidak boleh
		// orang yang sama dengan approval step 1 (mencegah satu orang approve dua tingkat sendiri).
		if (String(target.karyawan_id) === String(karyawan.id)) {
			throw error(400, 'Tidak bisa menyetujui pengajuan lembur sendiri.');
		}
		if (Number(target.atasan_approver_id) === Number(karyawan.id)) {
			throw error(403, 'Approval kedua (HRD) tidak boleh dilakukan oleh orang yang sama dengan approval pertama.');
		}
		if (!isHrdDivisi(karyawan.divisi)) {
			throw error(403, 'Lembur ini memerlukan approval kedua dari HRD.');
		}
	} else {
		// Tidak perlu eskalasi: aturan step-1 (atasan langsung, fallback rekan sedivisi) langsung final.
		await assertCanApproveLemburStep1(
			karyawan.id,
			karyawan.divisi,
			target.karyawan_id,
			'Tidak bisa menyetujui pengajuan lembur sendiri.'
		);
	}

	const payload = {
		status: 'Disetujui',
		approver_id: String(karyawan.id),
		approved_at: new Date().toISOString()
	};

	const result = await directusServerJson(`/items/ess_lembur/${id}`, {
		method: 'PATCH',
		body: JSON.stringify(payload)
	});

	// Jembatan P3: tanpa ini, lembur yang disetujui tidak pernah masuk payroll
	// (payrollSync.js hanya baca absensi_lembur berstatus published).
	try {
		await syncApprovedLemburToAbsensi({ ...target, status: 'Disetujui' });
	} catch (e) {
		console.error('[absensiLemburBridge] Gagal menyinkronkan lembur ke absensi_lembur:', e);
		throw error(502, 'Lembur disetujui tapi gagal disinkronkan ke payroll. Coba lagi atau hubungi HRD.');
	}

	try {
		await mirrorLegacyDecision({
			sourceCollection: 'ess_lembur',
			sourceId: id!,
			moduleKey: 'hrd.lembur',
			action: 'approve',
			actorKaryawanId: karyawan.id
		});
	} catch (e) {
		console.warn('[approvalMirror] gagal mirror approve lembur:', e);
	}

	// Notifikasi WA hasil ke karyawan (P5) — hanya dipanggil di approval FINAL (bukan step-1).
	await notifyApproved(target, karyawan.nama_karyawan);

	return json({ record: result?.data ?? result });
};

