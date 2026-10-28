// src/routes/api/biaya-lapangan/+server.ts
// Catat biaya lapangan (BBM/tol/parkir/lain) untuk siapa saja di lapangan, bukan hanya driver.
// Dua mode:
//   talangan → buat klaim_reimbursement + approval, katalog sebagai RMB
//   proyek   → catat realisasi di fleet_trip_expense, katalog sebagai BBM

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';
import { mirrorSubmitApprovalRequest } from '$lib/server/approvalMirror';
import { createMasterPengajuanEntry } from '$lib/server/masterPengajuanSubmit';
import { checkBbmVisitGate } from '$lib/server/visitGate';
import { getFieldGateMode } from '$lib/server/gateEnforcement';
import { evaluateExpenseGates, failedHardGates } from '$lib/server/gates/expenseGate';
import { isBookingBeruangMuka, keputusanDobel, labelPotensiDobel } from '$lib/utils/advanceDouble';

const JENIS_VALID = ['bbm', 'tol', 'parkir', 'lain'] as const;
type Jenis = (typeof JENIS_VALID)[number];

// Fase 5.6 v2 (9 Sep 2026, K4): ambang approval mode Dana Proyek. Default 0 = nonaktif
// (perilaku sekarang, tanpa approval sama sekali) — admin menaikkan sendiri lewat
// fleet_settings (FleetSettings.svelte, erp-epi). Cache 5 menit, pola sama modul lain.
let _bbmApprovalThresholdCache: { at: number; value: number } | null = null;
async function getBbmApprovalThreshold(): Promise<number> {
	if (_bbmApprovalThresholdCache && Date.now() - _bbmApprovalThresholdCache.at < 300_000) {
		return _bbmApprovalThresholdCache.value;
	}
	const res = await directusServerJson<{ data: { value: number } }>(
		`/items/fleet_settings/bbm_approval_threshold?fields=value`
	).catch(() => null);
	const value = Number(res?.data?.value) || 0;
	_bbmApprovalThresholdCache = { at: Date.now(), value };
	return value;
}

const TRIP_LOG_FIELD: Record<Jenis, string> = {
	bbm: 'biaya_bbm',
	tol: 'biaya_tol',
	parkir: 'biaya_parkir',
	lain: 'biaya_lain'
};

// Map jenis lapangan → kategori klaim_reimbursement
const JENIS_TO_KATEGORI: Record<Jenis, string> = {
	bbm: 'Transport',
	tol: 'Transport',
	parkir: 'Transport',
	lain: 'Lainnya'
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const form = await event.request.formData().catch(() => null);
	if (!form) throw error(400, 'Form data tidak valid.');

	const jenis = String(form.get('jenis') || '') as Jenis;
	const nominal = Number(form.get('nominal'));
	const catatan = String(form.get('catatan') || '').trim();
	const mode = String(form.get('mode') || 'talangan'); // 'talangan' | 'proyek'
	const projectId = form.get('project_id') ? Number(form.get('project_id')) : null;
	const tripId = form.get('trip_id') ? String(form.get('trip_id')) : null;
	// Biaya lapangan (BBM/tol/parkir) tidak selalu diajukan oleh diri sendiri — mis. sales
	// menalangi BBM untuk visit site. Bila diisi, karyawan inilah pemilik klaim reimburse.
	const forKaryawanId = form.get('for_karyawan_id') ? Number(form.get('for_karyawan_id')) : null;
	const struk = form.get('foto_struk');
	const siteCheckinId = form.get('site_checkin_id')?.toString()?.trim() || null;
	// Fase 1-3 v2 (9 Sep 2026): kolom bukti baru — semua opsional di request, pemaksaan
	// murni di lapisan gate (Aturan #3, nol constraint DB).
	const vehicleId = form.get('vehicle_id') ? String(form.get('vehicle_id')) : null;
	const odometerRaw = form.get('odometer');
	const odometer = odometerRaw ? Number(odometerRaw) : null;
	const fotoOdometer = form.get('foto_odometer');
	const suratJalanIdRaw = form.get('surat_jalan_id');

	if (!JENIS_VALID.includes(jenis)) throw error(400, 'Jenis biaya tidak valid.');
	if (!Number.isFinite(nominal) || nominal <= 0) throw error(400, 'Nominal tidak valid.');
	if (mode !== 'talangan' && mode !== 'proyek') throw error(400, 'Mode tidak valid.');
	// Proyek hanya wajib untuk realisasi Dana Proyek. Mode talangan (reimburse) boleh tanpa
	// proyek: biaya visit site / prospek yang belum ada nomor proyek tetap harus bisa diajukan.
	if (mode === 'proyek' && !projectId) throw error(400, 'Mode Dana Proyek wajib memilih proyek.');

	// Resolve karyawan tujuan (pemilik klaim). Default: pengaju sendiri.
	let target = karyawan;
	if (forKaryawanId && forKaryawanId !== karyawan.id) {
		const tRes = await directusServerJson<{ data: any[] }>(
			`/items/karyawan?filter[id][_eq]=${forKaryawanId}&fields=id,nama_karyawan,divisi&limit=1`
		);
		const row = tRes?.data?.[0];
		if (!row) throw error(404, 'Karyawan tujuan tidak ditemukan.');
		target = { ...karyawan, id: row.id, nama_karyawan: row.nama_karyawan, divisi: row.divisi ?? karyawan.divisi };
	}
	const inputByOther = target.id !== karyawan.id;
	const jejakInput = inputByOther ? ` (Diinput oleh ${karyawan.nama_karyawan})` : '';

	if (odometerRaw && (!Number.isFinite(odometer) || (odometer as number) < 0)) throw error(400, 'Odometer tidak valid.');

	// G_BBM_VISIT — "4-Gate Site Visit System" Fase 3b (8 Sep 2026): wajib site_checkin
	// aktif/selesai ATAU trip_id (peminjaman kendaraan tercatat = jalur alternatif sah).
	// Fase 0 v2 (9 Sep 2026): mode-aware lewat gate_enforcement (Aturan #3 — gate baru
	// TIDAK boleh lahir langsung wajib). Default 'shadow' sampai admin menaikkan mode.
	const bbmVisitMode = await getFieldGateMode('G_BBM_VISIT').catch(() => 'shadow');
	const visitCheck = await checkBbmVisitGate(siteCheckinId, tripId, String(target.id), todayJakarta()).catch((e) => ({
		allowed: false,
		reason: e instanceof Error ? e.message : 'Gagal memeriksa gate kunjungan'
	}));
	if (!visitCheck.allowed) {
		if (bbmVisitMode === 'hard') {
			throw error(400, `Gate G_BBM_VISIT: ${visitCheck.reason || 'Pencatatan biaya lapangan wajib terkait kunjungan atau peminjaman kendaraan yang sah.'}`);
		}
		console.warn(`[G_BBM_VISIT] mode=${bbmVisitMode} — gate gagal tapi tidak diblokir: ${visitCheck.reason}`);
	}

	// Upload foto struk (opsional)
	let strukId: string | null = null;
	if (struk instanceof File && struk.size > 0) {
		const uploadForm = new FormData();
		uploadForm.append('file', struk, `biaya-${karyawan.id}-${Date.now()}.jpg`);
		const uploadRes = await directusServerUpload(uploadForm);
		if (!uploadRes.ok) throw error(502, 'Gagal mengunggah foto struk.');
		const uploaded = await uploadRes.json();
		strukId = uploaded?.data?.id ?? null;
	}

	// Upload foto odometer (opsional — wajib secara gate saat G_BUKTI_BBM naik ke hard)
	let fotoOdometerId: string | null = null;
	if (fotoOdometer instanceof File && fotoOdometer.size > 0) {
		const uploadForm = new FormData();
		uploadForm.append('file', fotoOdometer, `odometer-${karyawan.id}-${Date.now()}.jpg`);
		const uploadRes = await directusServerUpload(uploadForm);
		if (!uploadRes.ok) throw error(502, 'Gagal mengunggah foto odometer.');
		const uploaded = await uploadRes.json();
		fotoOdometerId = uploaded?.data?.id ?? null;
	}

	// Fase 2/3 v2 (9 Sep 2026): G_P2H_UNIT_LAPANGAN, G_SJ_KIRIM (auto-derivasi),
	// G_BUKTI_BBM, G_BUKTI_STRUK — satu evaluasi, dipakai untuk KEDUA tulis (talangan ->
	// klaim_reimbursement + fleet_trip_expense, Aturan #8 idempoten & konsisten).
	const expenseGates = await evaluateExpenseGates({
		jenis,
		vehicleId,
		karyawanId: karyawan.id,
		driverId: null,
		fotoStrukId: strukId,
		odometer,
		fotoOdometerId,
		projectId,
		nominal,
		mode
	});
	const blockedGates = failedHardGates(expenseGates);
	if (blockedGates.length > 0) {
		throw error(400, `Pencatatan biaya tidak bisa dikirim: ${blockedGates.map((g) => `${g.key} — ${g.message}`).join('; ')}`);
	}
	for (const g of expenseGates) {
		if (g.status === 'failed' && g.mode !== 'hard') {
			console.warn(`[${g.key}] mode=${g.mode} — gate gagal tapi tidak diblokir: ${g.message}`);
		}
	}
	const sjKirimGate = expenseGates.find((g) => g.key === 'G_SJ_KIRIM');
	const suratJalanId = suratJalanIdRaw ? Number(suratJalanIdRaw) : (sjKirimGate?.ref as number | undefined) ?? null;

	// Validasi trip jika diberikan (boleh tidak active — ini berbeda dari endpoint driver)
	let trip: any = null;
	if (tripId) {
		const tripRes = await directusServerJson<{ data: any[] }>(
			`/items/fleet_trip_log?filter[id][_eq]=${tripId}&limit=1`
		);
		trip = tripRes?.data?.[0] ?? null;
		if (!trip) throw error(404, 'Trip tidak ditemukan.');
	}

	// G_ADVANCE_NO_DOUBLE (Peminjaman 06 Fase 3): struk perjalanan yang sudah ditanggung UANG MUKA harus lewat LPJ Kas Kecil,
	// bukan reimburse — kalau tidak uang keluar dua kali. Booking dicari lewat query terpisah dari trip (Aturan #2). Gagal baca →
	// dilog jelas dan klaim tidak ditahan (jangan memblokir lapangan atas data yang tak pasti). shadow = catat saja; soft = label.
	let dobelLabel = '';
	if (mode === 'talangan' && tripId) {
		let booking: any = null;
		try {
			const bRes = await directusServerJson<{ data: any[] }>(
				`/items/fleet_bookings?filter[trip_log_id][_eq]=${encodeURIComponent(tripId)}&fields=id,kode_booking,advance_diminta,advance_status&sort=-id&limit=1`
			);
			booking = bRes?.data?.[0] ?? null;
		} catch (e) {
			console.error('[G_ADVANCE_NO_DOUBLE] gagal membaca booking untuk trip', tripId, e instanceof Error ? e.message : e);
		}
		const gateMode = await getFieldGateMode('G_ADVANCE_NO_DOUBLE').catch((e) => {
			console.error('[G_ADVANCE_NO_DOUBLE] gagal membaca mode gate — dianggap shadow:', e instanceof Error ? e.message : e);
			return 'shadow' as const;
		});
		const aksi = keputusanDobel({ gateMode, modeBiaya: mode, jenis, beruangMuka: isBookingBeruangMuka(booking) });
		if (aksi === 'blokir') {
			throw error(
				409,
				`Gate G_ADVANCE_NO_DOUBLE: perjalanan ${booking?.kode_booking || ''} memakai uang muka. Struk BBM/tol/parkir-nya lewat LPJ Kas Kecil (Petty Cash), bukan reimburse. Bila biaya ini bukan untuk perjalanan tersebut, ajukan tanpa mengaitkan perjalanan.`
			);
		}
		if (aksi === 'label') dobelLabel = ` ${labelPotensiDobel(tripId, booking?.kode_booking)}`;
		if (aksi !== 'lolos') {
			console.warn(`[G_ADVANCE_NO_DOUBLE] mode=${gateMode} aksi=${aksi} trip=${tripId} booking=${booking?.kode_booking} jenis=${jenis} nominal=${nominal}`);
		}
	}

	// ── MODE: DANA PROYEK / KARTU ────────────────────────────────────────────
	if (mode === 'proyek') {
		// Fase 5.6 v2 (9 Sep 2026, K4): celah terbesar rencana v1 — mode Dana Proyek
		// SEBELUMNYA masuk tanpa approval sama sekali, padahal mode talangan (uang
		// pribadi, risiko lebih kecil) justru lewat approval penuh. Ambang di
		// fleet_settings, default 0 = nonaktif (nol regresi sampai admin menaikkan).
		const approvalThreshold = await getBbmApprovalThreshold();
		const approvalStatus = approvalThreshold > 0 && nominal > approvalThreshold ? 'menunggu' : 'langsung';

		const expensePayload: Record<string, any> = {
			jenis,
			nominal,
			foto_struk: strukId,
			catatan: `${catatan}${jejakInput}`.trim() || null,
			waktu: new Date().toISOString(),
			project_id: projectId,
			karyawan_id: String(target.id),
			mode: 'proyek',
			// Fase 0 v2 (9 Sep 2026): fleet_trip_expense.site_checkin_id sudah diperbaiki ke
			// varchar(36) — kirim string uuid langsung, JANGAN Number() (selalu NaN untuk uuid).
			site_checkin_id: siteCheckinId || null,
			odometer,
			foto_odometer: fotoOdometerId,
			surat_jalan_id: suratJalanId,
			tujuan_kirim_barang: !!suratJalanId,
			approval_status: approvalStatus
		};
		if (tripId) expensePayload.trip_log_id = tripId;

		const expense = await directusServerJson<{ data: any }>('/items/fleet_trip_expense', {
			method: 'POST',
			body: JSON.stringify(expensePayload)
		});
		const expenseId = expense?.data?.id;

		// Increment biaya_* di trip jika ada
		if (trip && tripId) {
			const field = TRIP_LOG_FIELD[jenis];
			const currentValue = Number(trip[field] ?? 0);
			await directusServerJson(`/items/fleet_trip_log/${tripId}`, {
				method: 'PATCH',
				body: JSON.stringify({ [field]: currentValue + nominal })
			}).catch((e: any) => console.warn('[biayaLapangan] gagal update trip_log:', e?.message));
		}

		const jenisLabel = { bbm: 'BBM', tol: 'Tol', parkir: 'Parkir', lain: 'Lain-lain' }[jenis];

		// Approval mirror (best-effort) — HANYA saat di atas ambang. Rantai approver
		// (termasuk fallback self-approval, Aturan #4) ditangani generik oleh Universal
		// Approval Engine berdasarkan module_key, sama seperti hrd.reimburse di bawah —
		// modul ini tidak membangun ulang resolusi approver.
		if (approvalStatus === 'menunggu') {
			try {
				await mirrorSubmitApprovalRequest({
					moduleKey: 'fleet.biaya_proyek',
					sourceCollection: 'fleet_trip_expense',
					sourceId: expenseId,
					title: `Biaya ${jenisLabel} Dana Proyek — ${karyawan.nama_karyawan}`,
					summary: catatan || null,
					amount: nominal,
					departmentKey: karyawan.divisi,
					requesterId: karyawan.id
				});
			} catch (e) {
				console.warn('[biayaLapangan] gagal mirror approval Dana Proyek:', e);
			}
		}
		createMasterPengajuanEntry({
			kategori: 'proyek',
			jenisPengajuan: 'BBM',
			judul: `Biaya ${jenisLabel} — ${target.nama_karyawan}`,
			deskripsi: `${catatan}${jejakInput}`.trim() || null,
			totalAmount: nominal,
			pengajuId: target.id,
			departmentKey: target.divisi,
			projectId,
			detailRefCollection: 'fleet_trip_expense',
			detailRefId: expenseId,
			sourceApp: 'field'
		}).catch((e: any) =>
			console.warn('[masterPengajuanSubmit] gagal katalog BBM (diabaikan):', e?.message)
		);

		return json({ mode: 'proyek', record: expense?.data ?? expense });
	}

	// ── MODE: TALANGAN PRIBADI → REIMBURSE ───────────────────────────────────
	const jenisLabel = { bbm: 'BBM', tol: 'Tol', parkir: 'Parkir', lain: 'Lain-lain' }[jenis];
	const kategori = JENIS_TO_KATEGORI[jenis];
	const catatanRmb =
		(catatan
			? `Biaya ${jenisLabel} lapangan: ${catatan}`
			: `Biaya ${jenisLabel} lapangan`) + jejakInput + dobelLabel;

	const reimbursePayload: Record<string, any> = {
		karyawan_id: String(target.id),
		tanggal_pengajuan: todayJakarta(),
		kategori,
		jumlah: nominal,
		bukti_pendukung: strukId,
		catatan: catatanRmb,
		status: 'Diajukan',
		// Fase 0 v2 (9 Sep 2026): klaim_reimbursement.site_checkin_id sudah diperbaiki ke
		// varchar(36) — kirim string uuid langsung, JANGAN Number() (selalu NaN untuk uuid).
		site_checkin_id: siteCheckinId || null
	};
	if (projectId) reimbursePayload.project_id = projectId;

	const rmb = await directusServerJson<any>('/items/klaim_reimbursement', {
		method: 'POST',
		body: JSON.stringify(reimbursePayload)
	});
	const rmbId = rmb?.data?.id ?? rmb?.id;

	// Catat juga di fleet_trip_expense (untuk laporan biaya operasional kendaraan/proyek).
	// Aturan #8 (idempoten & konsisten): gate SUDAH dievaluasi sekali di atas (expenseGates)
	// dan dipakai untuk kedua tulis ini — tidak ada yang lolos sendirian.
	const expensePayload2: Record<string, any> = {
		jenis,
		nominal,
		foto_struk: strukId,
		catatan: `${catatan}${jejakInput}${dobelLabel}`.trim() || null,
		waktu: new Date().toISOString(),
		project_id: projectId,
		karyawan_id: String(target.id),
		mode: 'talangan',
		// Fase 0 v2 (9 Sep 2026): fleet_trip_expense.site_checkin_id sudah diperbaiki ke
		// varchar(36) — kirim string uuid langsung, JANGAN Number() (selalu NaN untuk uuid).
		site_checkin_id: siteCheckinId || null,
		odometer,
		foto_odometer: fotoOdometerId,
		surat_jalan_id: suratJalanId,
		tujuan_kirim_barang: !!suratJalanId
	};
	if (tripId) expensePayload2.trip_log_id = tripId;

	await directusServerJson('/items/fleet_trip_expense', {
		method: 'POST',
		body: JSON.stringify(expensePayload2)
	}).catch((e: any) => console.warn('[biayaLapangan] gagal catat fleet_trip_expense:', e?.message));

	// Increment biaya_* di trip jika ada
	if (trip && tripId) {
		const field = TRIP_LOG_FIELD[jenis];
		const currentValue = Number(trip[field] ?? 0);
		await directusServerJson(`/items/fleet_trip_log/${tripId}`, {
			method: 'PATCH',
			body: JSON.stringify({ [field]: currentValue + nominal })
		}).catch((e: any) => console.warn('[biayaLapangan] gagal update trip_log:', e?.message));
	}

	// Approval mirror (best-effort)
	try {
		await mirrorSubmitApprovalRequest({
			moduleKey: 'hrd.reimburse',
			sourceCollection: 'klaim_reimbursement',
			sourceId: rmbId,
			title: `Reimburse ${jenisLabel} Lapangan — ${target.nama_karyawan}`,
			summary: catatanRmb,
			amount: nominal,
			departmentKey: target.divisi,
			requesterId: target.id
		});
	} catch (e) {
		console.warn('[biayaLapangan] gagal mirror approval reimburse:', e);
	}

	createMasterPengajuanEntry({
		kategori: 'hrd',
		jenisPengajuan: 'RMB',
		judul: `Reimburse ${jenisLabel} Lapangan — ${target.nama_karyawan}`,
		deskripsi: catatanRmb,
		totalAmount: nominal,
		pengajuId: target.id,
		departmentKey: target.divisi,
		projectId,
		detailRefCollection: 'klaim_reimbursement',
		detailRefId: rmbId,
		sourceApp: 'field'
	}).catch((e: any) =>
		console.warn('[masterPengajuanSubmit] gagal katalog RMB (diabaikan):', e?.message)
	);

	return json({ mode: 'talangan', record: rmb?.data ?? rmb });
};
