// src/routes/api/site-checkin/my-visits/+server.ts
// "4-Gate Site Visit System" Fase 3b (8 Sep 2026) — daftar kunjungan milik pengaju untuk
// VisitPicker (reimburse & biaya-lapangan). Beda dari GET /api/site-checkin (yang selalu
// "hari ini" WIB, dipakai ActiveCheckinBar dkk) — endpoint ini menerima rentang hari dan
// dipakai murni untuk memilih kunjungan sebagai bukti pengajuan finansial.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { getSiteCheckinSettings } from '$lib/server/siteCheckin';

const DEFAULT_DAYS = 7;
const MAX_DAYS = 90;

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const daysParam = parseInt(event.url.searchParams.get('days') || '', 10);
	const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, MAX_DAYS) : DEFAULT_DAYS;
	const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

	// Paket 05 §3.2 (SVR-21) — ambang picker klaim finansial DIBACA dari settings (bukan 30
	// hardcode); sengaja terpisah dari settings.min_durasi_menit (payroll) karena picker ini
	// untuk klaim finansial, bukan sinkron payroll otomatis.
	const settings = await getSiteCheckinSettings().catch(() => null);
	const minDurasiFinansial = settings?.min_durasi_menit_finansial ?? 30;

	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawan.id),
		'filter[check_in_at][_gte]': since,
		'filter[status][_in]': 'completed,active',
		fields:
			'id,tipe_checkin,referensi_id,nama_lokasi,check_in_at,check_out_at,durasi_menit,in_geofence,anti_fake_gps_score,status',
		sort: '-check_in_at',
		limit: '50'
	});
	const res = await directusServerJson<{ data: any[] }>(`/items/site_checkin?${query.toString()}`);

	const visits = (res?.data || []).map((v) => ({
		id: v.id,
		tipe_checkin: v.tipe_checkin,
		nama_lokasi: v.nama_lokasi,
		check_in_at: v.check_in_at,
		check_out_at: v.check_out_at,
		durasi_menit: v.durasi_menit,
		in_geofence: v.in_geofence,
		status: v.status,
		flagged_durasi_rendah: v.status === 'completed' && Number.isFinite(v.durasi_menit) && v.durasi_menit < minDurasiFinansial,
		flagged_luar_geofence: v.in_geofence === false && (!Number.isFinite(parseFloat(v.anti_fake_gps_score)) || parseFloat(v.anti_fake_gps_score) < 0.5)
	}));

	return json({ visits, days });
};
