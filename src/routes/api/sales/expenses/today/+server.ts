// src/routes/api/sales/expenses/today/+server.ts
// Fase 2 Ops Sales Gate & Reimbursement — rekap dan tambah pengeluaran operasional hari ini.
// Membaca dari fleet_trip_expense & site_checkin untuk Laporan Harian Sales.

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
	const { karyawan } = await authenticateEss(event);
	const targetDate = event.url.searchParams.get('date') || todayJakarta();

	const startIso = `${targetDate}T00:00:00.000Z`;
	const endIso = `${targetDate}T23:59:59.999Z`;

	// 1. Ambil semua expense karyawan hari ini (Directus Single Source of Truth)
	const expRes = await directusServerJson<{ data: any[] }>(
		`/items/fleet_trip_expense?filter[karyawan_id][_eq]=${karyawan.id}&filter[waktu][_gte]=${encodeURIComponent(startIso)}&filter[waktu][_lte]=${encodeURIComponent(endIso)}&sort=-id&limit=100`
	).catch(() => null);

	const rawExpenses = expRes?.data || [];

	// 2. Fetch terpisah untuk relasi site_checkin (Aturan: Directus query dipisah per relasi)
	const checkinIds = [...new Set(rawExpenses.map((e) => e.site_checkin_id).filter(Boolean))];
	const checkinMap = new Map<string, { id: string; visit_sales_id: number | null; nama_lokasi: string }>();

	if (checkinIds.length > 0) {
		const scRes = await directusServerJson<{ data: any[] }>(
			`/items/site_checkin?filter[id][_in]=${encodeURIComponent(checkinIds.join(','))}&fields=id,visit_sales_id,nama_lokasi&limit=100`
		).catch(() => null);

		for (const row of scRes?.data || []) {
			checkinMap.set(String(row.id), {
				id: String(row.id),
				visit_sales_id: row.visit_sales_id ? Number(row.visit_sales_id) : null,
				nama_lokasi: row.nama_lokasi || ''
			});
		}
	}

	// 3. Fetch terpisah untuk relasi visit_sales (jika ada visit_sales_id)
	const visitIds = [
		...new Set(
			Array.from(checkinMap.values())
				.map((c) => c.visit_sales_id)
				.filter(Boolean)
		)
	];
	const visitMap = new Map<number, { id: number; tujuan: string }>();

	if (visitIds.length > 0) {
		const vsRes = await directusServerJson<{ data: any[] }>(
			`/items/visit_sales?filter[id][_in]=${encodeURIComponent(visitIds.join(','))}&fields=id,tujuan&limit=100`
		).catch(() => null);

		for (const row of vsRes?.data || []) {
			visitMap.set(Number(row.id), {
				id: Number(row.id),
				tujuan: row.tujuan || ''
			});
		}
	}

	// 4. Gabungkan relasi secara bersih
	const expenses = rawExpenses.map((e) => {
		const checkin = e.site_checkin_id ? checkinMap.get(String(e.site_checkin_id)) : null;
		const visit = checkin?.visit_sales_id ? visitMap.get(checkin.visit_sales_id) : null;
		const lokasiNama = visit?.tujuan || checkin?.nama_lokasi || 'Operasional Umum';

		return {
			id: e.id,
			jenis: e.jenis,
			nominal: Number(e.nominal) || 0,
			foto_struk: e.foto_struk || null,
			catatan: e.catatan || null,
			waktu: e.waktu,
			mode: e.mode,
			site_checkin_id: e.site_checkin_id || null,
			visit_sales_id: checkin?.visit_sales_id || null,
			lokasi_nama: lokasiNama
		};
	});

	const totalNominal = expenses.reduce((sum, e) => sum + e.nominal, 0);
	const totalCount = expenses.length;

	return json({
		success: true,
		targetDate,
		expenses,
		totalNominal,
		totalCount
	});
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const form = await event.request.formData().catch(() => null);
	if (!form) throw error(400, 'Form data tidak valid.');

	const visitSalesIdRaw = form.get('visit_sales_id')?.toString()?.trim() || null;
	const visitSalesId = visitSalesIdRaw ? Number(visitSalesIdRaw) : null;

	const jenisRaw = String(form.get('jenis') || 'lain').toLowerCase().trim();
	const validJenis = ['bbm', 'tol', 'parkir', 'lain'];
	const jenis = validJenis.includes(jenisRaw) ? jenisRaw : 'lain';
	const nominal = Number(form.get('nominal'));
	const catatan = String(form.get('catatan') || '').trim();
	const struk = form.get('foto_struk');

	if (!Number.isFinite(nominal) || nominal <= 0) {
		throw error(400, 'Nominal biaya wajib lebih dari 0.');
	}

	let siteCheckinId: string | null = null;
	let labelTujuan = 'Operasional Harian';

	// Jika dikaitkan dengan kunjungan spesifik
	if (visitSalesId && Number.isFinite(visitSalesId)) {
		const vsRes = await directusServerJson<{ data: any }>(
			`/items/visit_sales/${visitSalesId}?fields=id,tujuan`
		).catch(() => null);
		if (vsRes?.data?.tujuan) labelTujuan = vsRes.data.tujuan;

		const scRes = await directusServerJson<{ data: Array<{ id: string }> }>(
			`/items/site_checkin?filter[visit_sales_id][_eq]=${visitSalesId}&fields=id&limit=1`
		).catch(() => null);
		siteCheckinId = scRes?.data?.[0]?.id || null;
	} else {
		// Cari site_checkin marketing aktif/terbaru hari ini milik karyawan
		const today = todayJakarta();
		const scRes = await directusServerJson<{ data: Array<{ id: string; nama_lokasi: string }> }>(
			`/items/site_checkin?filter[karyawan_id][_eq]=${karyawan.id}&filter[tipe_keperluan][_eq]=marketing&filter[check_in_at][_gte]=${today}T00:00:00.000Z&sort=-check_in_at&limit=1`
		).catch(() => null);
		if (scRes?.data?.[0]) {
			siteCheckinId = scRes.data[0].id;
			if (scRes.data[0].nama_lokasi) labelTujuan = scRes.data[0].nama_lokasi;
		}
	}

	// Upload foto struk jika ada
	let strukId: string | null = null;
	if (struk instanceof File && struk.size > 0) {
		const uploadForm = new FormData();
		uploadForm.append('file', struk, `bon-harian-${karyawan.id}-${Date.now()}.jpg`);
		const uploadRes = await directusServerUpload(uploadForm);
		if (!uploadRes.ok) throw error(502, 'Gagal mengunggah foto bon/struk.');
		const uploaded = await uploadRes.json().catch(() => null);
		strukId = uploaded?.data?.id ?? null;
	}

	const deskripsi = catatan || `Biaya ${jenis.toUpperCase()} - ${labelTujuan}`;

	// Tulis ke fleet_trip_expense
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

	// Tulis ke klaim_reimbursement
	const reimbursePayload = {
		karyawan_id: String(karyawan.id),
		tanggal_pengajuan: todayJakarta(),
		kategori: JENIS_TO_KATEGORI[jenis] || 'Lainnya',
		jumlah: nominal,
		bukti_pendukung: strukId,
		catatan: `[Ops Sales - ${labelTujuan}] ${deskripsi}`,
		status: 'Diajukan',
		site_checkin_id: siteCheckinId
	};
	await directusServerJson('/items/klaim_reimbursement', {
		method: 'POST',
		body: JSON.stringify(reimbursePayload)
	}).catch((e: any) => console.warn('[sales/expenses/today] Gagal catat klaim_reimbursement:', e?.message));

	return json({
		success: true,
		expense: createdExp?.data ?? createdExp
	});
};
