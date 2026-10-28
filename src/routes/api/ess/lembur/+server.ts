import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { mirrorSubmitApprovalRequest } from '$lib/server/approvalMirror';
import { createMasterPengajuanEntry } from '$lib/server/masterPengajuanSubmit';
import { findTodayRecord, isEmptyTime } from '$lib/server/ess/absensi';
import { calculateOvertimeMultipliers } from '$lib/server/ess/overtimeCalculator';
import { isNationalHolidayOn } from '$lib/server/ess/holidays';
import { notifySubmitted } from '$lib/server/ess/lemburNotify';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const form = await event.request.formData();
	const tanggal = form.get('tanggal')?.toString();
	const jamMulai = form.get('jam_mulai')?.toString();
	const jamSelesai = form.get('jam_selesai')?.toString();
	const alasan = form.get('alasan')?.toString()?.trim() || '';
	const bukti = form.get('bukti');
	const lat = form.get('latitude')?.toString() || null;
	const lng = form.get('longitude')?.toString() || null;
	const proyekId = form.get('proyek_id')?.toString() || null;

	if (!tanggal) throw error(400, 'Tanggal wajib diisi.');
	if (!jamMulai || !jamSelesai) throw error(400, 'Jam mulai dan selesai wajib diisi.');
	if (jamMulai === jamSelesai) throw error(400, 'Jam mulai dan jam selesai tidak boleh sama.');

	// 1. Cross-Validation Absensi Presensi: cek clock-in di absensi_harian pada tanggal yang sama.
	// Tidak diblokir keras — bila tidak ada, tandai status_absensi_valid=false dan wajib
	// diverifikasi manual oleh HRD sebelum pengajuan bisa disetujui.
	const absensiRecord = await findTodayRecord(karyawan.id, tanggal);
	const statusAbsensiValid = !!absensiRecord && !isEmptyTime(absensiRecord.jam_masuk);

	// 2. Perhitungan Multiplier Tarif Regulasi UU (PP No. 35 / 2021), dengan deteksi hari libur
	// nasional dari koleksi holidays (bukan hanya Sabtu/Minggu).
	const isNationalHoliday = await isNationalHolidayOn(tanggal);
	const overtimeCalc = calculateOvertimeMultipliers({
		tanggal,
		jamMulai,
		jamSelesai,
		isNationalHoliday
	});

	if (overtimeCalc.durasiJam <= 0) {
		throw error(400, 'Durasi lembur tidak valid (minimal 30 menit).');
	}

	// P4: lembur >4 jam/hari atau di hari libur wajib eskalasi approval kedua ke HRD
	// (PP 35/2021 Ps. 26 + kebijakan internal) sebelum bridge P3 ke payroll jalan.
	const requiresHrdApproval = overtimeCalc.durasiJam > 4 || overtimeCalc.isHariLibur;

	let buktiId: string | null = null;
	if (bukti instanceof File && bukti.size > 0) {
		const uploadForm = new FormData();
		uploadForm.append('file', bukti, `lembur-${karyawan.id}-${Date.now()}.jpg`);
		const uploadRes = await directusServerUpload(uploadForm);
		if (!uploadRes.ok) throw error(502, 'Gagal mengunggah bukti.');
		const uploaded = await uploadRes.json();
		buktiId = uploaded?.data?.id || null;
	}

	const payload = {
		karyawan_id: String(karyawan.id),
		tanggal,
		jam_mulai: jamMulai,
		jam_selesai: jamSelesai,
		alasan,
		bukti: buktiId,
		status: 'Diajukan',
		durasi_jam: overtimeCalc.durasiJam,
		is_hari_libur: overtimeCalc.isHariLibur,
		total_jam_setara: overtimeCalc.totalJamSetara,
		multiplier_breakdown: overtimeCalc.multiplierBreakdown,
		status_absensi_valid: statusAbsensiValid,
		requires_hrd_approval: requiresHrdApproval,
		latitude: lat,
		longitude: lng,
		proyek_id: proyekId
	};

	const result = await directusServerJson('/items/ess_lembur', {
		method: 'POST',
		body: JSON.stringify(payload)
	});

	const recordId = result?.data?.id ?? result?.id;
	try {
		await mirrorSubmitApprovalRequest({
			moduleKey: 'hrd.lembur',
			sourceCollection: 'ess_lembur',
			sourceId: recordId,
			title: `Lembur ${tanggal} (${overtimeCalc.durasiJam} Jam) — ${karyawan.nama_karyawan}`,
			summary: alasan || null,
			amount: null,
			departmentKey: karyawan.divisi,
			requesterId: karyawan.id
		});
	} catch (e) {
		console.warn('[approvalMirror] gagal mendaftarkan lembur ke Inbox terpusat:', e);
	}

	createMasterPengajuanEntry({
		kategori: 'hrd',
		jenisPengajuan: 'LMB',
		judul: `Lembur ${tanggal} (${overtimeCalc.durasiJam} Jam) — ${karyawan.nama_karyawan}`,
		deskripsi: alasan || null,
		pengajuId: karyawan.id,
		departmentKey: karyawan.divisi,
		projectId: proyekId ? Number(proyekId) : null,
		detailRefCollection: 'ess_lembur',
		detailRefId: recordId,
		sourceApp: 'field'
	}).catch((e: any) => console.warn('[masterPengajuanSubmit] gagal katalog LMB (diabaikan):', e?.message));

	// 3. Notifikasi WA ke penyetuju (P5) — langsung via Fonnte lewat relay erp-epi-1.
	await notifySubmitted(
		{ karyawan_id: String(karyawan.id), tanggal, durasi_jam: overtimeCalc.durasiJam },
		karyawan.nama_karyawan
	);

	return json({ record: result?.data ?? result, overtimeCalc });
};

