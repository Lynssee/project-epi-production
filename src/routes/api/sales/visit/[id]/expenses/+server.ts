// src/routes/api/sales/visit/[id]/expenses/+server.ts
// Fase 2 Ops Sales Gate & Reimbursement — catat dan ambil bukti bon/biaya operasional kunjungan.
// Menghubungkan struk fisik (BBM, E-Toll, Parkir, Konsumsi) ke site_checkin dan visit_sales.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { authenticateEss } from '$lib/server/ess/attendanceGuard.ts';
import { directusServerJson, directusServerUpload } from '$lib/server/directus.ts';
import { todayJakarta } from '$lib/server/ess/time.ts';

const JENIS_TO_KATEGORI: Record<string, string> = {
	bbm: 'Transport',
	tol: 'Transport',
	parkir: 'Transport',
	lain: 'Lainnya'
};

export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);
	const visitId = Number(event.params.id);
	if (!Number.isFinite(visitId) || visitId <= 0) {
		throw error(400, 'ID kunjungan tidak valid.');
	}

	// 1. Cari site_checkin yang tertaut ke visit_sales_id ini
	const scRes = await directusServerJson<{
		data: Array<{ id: string; visit_sales_id: number; nama_lokasi: string; check_in_at: string }>;
	}>(
		`/items/site_checkin?filter[visit_sales_id][_eq]=${visitId}&fields=id,visit_sales_id,nama_lokasi,check_in_at&limit=1`
	).catch(() => null);
	const siteCheckin = scRes?.data?.[0];

	if (!siteCheckin?.id) {
		return json({
			success: true,
			expenses: [],
			siteCheckinId: null,
			totalNominal: 0
		});
	}

	// 2. Ambil catatan biaya dari fleet_trip_expense berdasarkan site_checkin_id
	const expRes = await directusServerJson<{
		data: Array<{
			id: number;
			jenis: string;
			nominal: number;
			foto_struk: string | null;
			catatan: string | null;
			waktu: string;
			mode: string;
			karyawan_id: string;
		}>;
	}>(
		`/items/fleet_trip_expense?filter[site_checkin_id][_eq]=${siteCheckin.id}&fields=id,jenis,nominal,foto_struk,catatan,waktu,mode,karyawan_id&sort=-id&limit=50`
	).catch(() => null);

	const expenses = expRes?.data || [];
	const totalNominal = expenses.reduce((sum, e) => sum + (Number(e.nominal) || 0), 0);

	return json({
		success: true,
		expenses,
		siteCheckinId: siteCheckin.id,
		totalNominal
	});
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const visitId = Number(event.params.id);
	if (!Number.isFinite(visitId) || visitId <= 0) {
		throw error(400, 'ID kunjungan tidak valid.');
	}

	// 1. Verifikasi kunjungan sales
	const visitRes = await directusServerJson<{ data: any }>(
		`/items/visit_sales/${visitId}?fields=id,sales_id,sales_name,tujuan`
	).catch(() => null);
	const visit = visitRes?.data;
	if (!visit) throw error(404, 'Kunjungan sales tidak ditemukan.');

	// 2. Ambil site_checkin tertaut
	const scRes = await directusServerJson<{ data: Array<{ id: string; status: string }> }>(
		`/items/site_checkin?filter[visit_sales_id][_eq]=${visitId}&fields=id,status&limit=1`
	).catch(() => null);
	const siteCheckin = scRes?.data?.[0];
	const siteCheckinId = siteCheckin?.id || null;

	const form = await event.request.formData().catch(() => null);
	if (!form) throw error(400, 'Form data tidak valid.');

	const jenisRaw = String(form.get('jenis') || 'lain').toLowerCase().trim();
	const validJenis = ['bbm', 'tol', 'parkir', 'lain'];
	const jenis = validJenis.includes(jenisRaw) ? jenisRaw : 'lain';
	const nominal = Number(form.get('nominal'));
	const catatan = String(form.get('catatan') || '').trim();
	const struk = form.get('foto_struk');

	if (!Number.isFinite(nominal) || nominal <= 0) {
		throw error(400, 'Nominal biaya wajib lebih dari 0.');
	}

	// 3. Upload foto struk / bon jika dilampirkan
	let strukId: string | null = null;
	if (struk instanceof File && struk.size > 0) {
		const uploadForm = new FormData();
		uploadForm.append('file', struk, `bon-sales-${visitId}-${Date.now()}.jpg`);
		const uploadRes = await directusServerUpload(uploadForm);
		if (!uploadRes.ok) throw error(502, 'Gagal mengunggah foto bon/struk.');
		const uploaded = await uploadRes.json().catch(() => null);
		strukId = uploaded?.data?.id ?? null;
	}

	const deskripsi = catatan || `Biaya ${jenis.toUpperCase()} kunjungan ${visit.tujuan || visitId}`;

	// 4. Tulis ke fleet_trip_expense (sumber agregasi operasional lapangan)
	const expensePayload = {
		jenis,
		nominal,
		foto_struk: strukId,
		catatan: deskripsi,
		waktu: new Date().toISOString(),
		karyawan_id: String(karyawan.id),
		mode: 'talangan',
		site_checkin_id: siteCheckinId,
		approval_status: 'langsung'
	};

	const createdExp = await directusServerJson<{ data: any }>('/items/fleet_trip_expense', {
		method: 'POST',
		body: JSON.stringify(expensePayload)
	});

	// 5. Tulis juga ke klaim_reimbursement (jalur reimbursement HRD/Finance)
	const reimbursePayload = {
		karyawan_id: String(karyawan.id),
		tanggal_pengajuan: todayJakarta(),
		kategori: JENIS_TO_KATEGORI[jenis] || 'Lainnya',
		jumlah: nominal,
		bukti_pendukung: strukId,
		catatan: `[Ops Sales - ${visit.tujuan || 'Visit'}] ${deskripsi}`,
		status: 'Diajukan',
		site_checkin_id: siteCheckinId
	};
	await directusServerJson('/items/klaim_reimbursement', {
		method: 'POST',
		body: JSON.stringify(reimbursePayload)
	}).catch((e: any) => console.warn('[sales/expenses] Gagal catat klaim_reimbursement:', e?.message));

	return json({
		success: true,
		expense: createdExp?.data ?? createdExp
	});
};

export const DELETE: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const expenseId = Number(event.url.searchParams.get('expense_id'));
	if (!Number.isFinite(expenseId) || expenseId <= 0) {
		throw error(400, 'ID biaya tidak valid.');
	}

	// Verifikasi kepemilikan
	const expRes = await directusServerJson<{ data: any }>(
		`/items/fleet_trip_expense/${expenseId}?fields=id,karyawan_id,site_checkin_id`
	).catch(() => null);
	const exp = expRes?.data;
	if (!exp) throw error(404, 'Biaya tidak ditemukan.');

	if (String(exp.karyawan_id) !== String(karyawan.id)) {
		throw error(403, 'Anda bukan pemilik catatan biaya ini.');
	}

	await directusServerJson(`/items/fleet_trip_expense/${expenseId}`, {
		method: 'DELETE'
	});

	return json({ success: true, deletedId: expenseId });
};
