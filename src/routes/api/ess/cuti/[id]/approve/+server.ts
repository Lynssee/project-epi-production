import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { findCutiById, applyCutiApprovalToAbsensi, getSisaCutiTahunIni } from '$lib/server/ess/cuti';
import { assertCanApprove } from '$lib/server/ess/divisi';
import { mirrorLegacyDecision } from '$lib/server/approvalMirror';
import { createAutoDelegationForLeave } from '$lib/server/ess/autoDelegation';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const id = event.params.id;

	const target = await findCutiById(id!);
	if (!target) throw error(404, 'Pengajuan cuti tidak ditemukan.');
	if (target.status !== 'Diajukan') throw error(409, 'Pengajuan ini sudah diproses.');

	await assertCanApprove(karyawan.id, karyawan.divisi, target.karyawan_id, 'Tidak bisa menyetujui pengajuan cuti sendiri.');

	// Fase 4.4: blokir approve bila saldo cuti tahunan tidak cukup (hanya berlaku utk jenis 'Cuti
	// Tahunan' — Cuti Khusus/Melahirkan/Sakit/Tidak Berbayar pakai kuota lain, tidak dicek di sini).
	if (target.jenis_cuti === 'Cuti Tahunan') {
		const saldo = await getSisaCutiTahunIni(Number(target.karyawan_id));
		if (Number(target.jumlah_hari) > saldo.sisa) {
			throw error(400, `Sisa cuti tahunan karyawan ini hanya ${saldo.sisa} hari, pengajuan ${target.jumlah_hari} hari. Tidak bisa disetujui dari sini — hubungi HRD untuk override manual di Admin.`);
		}
	}

	const payload = {
		status: 'Disetujui',
		approver_id: String(karyawan.id),
		approved_at: new Date().toISOString(),
		disetujui_oleh: karyawan.nama_karyawan
	};

	const result = await directusServerJson(`/items/cuti_karyawan/${id}`, {
		method: 'PATCH',
		body: JSON.stringify(payload)
	});

	try {
		await applyCutiApprovalToAbsensi({
			karyawan_id: target.karyawan_id,
			tanggal_mulai: target.tanggal_mulai,
			tanggal_selesai: target.tanggal_selesai,
			jenis_cuti: target.jenis_cuti
		});
	} catch (e) {
		console.warn('[ess/cuti/approve] gagal generate absensi_harian dari cuti:', e);
	}

	try {
		await mirrorLegacyDecision({
			sourceCollection: 'cuti_karyawan',
			sourceId: id!,
			moduleKey: 'hrd.cuti',
			action: 'approve',
			actorKaryawanId: karyawan.id
		});
	} catch (e) {
		console.warn('[approvalMirror] gagal mirror approve cuti:', e);
	}

	// Approval Delegation (auto-trigger, rencana "Package & Fitur Addons" §3) — jalur lokal
	// ini paralel dengan Approval Center erp-epi-1 (lihat catatan T4-lanjutan di
	// api/ess/cuti/approval-callback/+server.js sana), jadi perlu memicu delegasi otomatis
	// juga di sini supaya tidak ada celah tergantung jalur mana yang dipakai approver.
	const delegasi = await createAutoDelegationForLeave({
		karyawanId: target.karyawan_id,
		delegateId: target.delegasi_karyawan_id,
		startDate: target.tanggal_mulai,
		endDate: target.tanggal_selesai
	});

	return json({ record: result?.data ?? result, delegasi });
};
