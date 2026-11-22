// src/routes/api/produksi/data-health/+server.ts
// Fase 5 (Laporan Bulanan Manufaktur): banner hub produksi — SPK belum di-QC & SPK berjalan tanpa deadline.
//   GET -> { success, data: SpkDataHealth }   (hanya baca, 2 query terpisah & ramping; jendela default 30 hari)
// Izin: sama dengan hub produksi (input_produksi_harian). Gagal baca Directus = 502 transparan, BUKAN angka 0.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { requirePermission } from '$lib/server/rbacServer';
import { directusServerJson } from '$lib/server/directus';
import { summarizeSpkDataHealth, type SpkHealthRow } from '$lib/server/produksi/dataHealth';

const PERMISSION = 'input_produksi_harian';
const WINDOW_DAYS = 30;

const jakartaDate = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	await requirePermission(event, user.localId, PERMISSION);

	const since = jakartaDate(new Date(Date.now() - WINDOW_DAYS * 86_400_000));
	try {
		const [belumQc, aktif] = await Promise.all([
			// Hanya SPK dengan status completed/qc_pending dalam jendela; quality_status kosong disaring di sini (Directus _null).
			directusServerJson<{ data: SpkHealthRow[] }>(
				`/items/spk?filter[status][_in]=completed,qc_pending&filter[completed_date][_gte]=${since}&filter[quality_status][_null]=true&fields=id,nomor,quality_status&sort=-id&limit=200`
			),
			directusServerJson<{ data: SpkHealthRow[] }>(
				`/items/spk?filter[status][_eq]=in_progress&filter[production_deadline][_null]=true&fields=id,nomor,production_deadline&sort=-id&limit=200`
			)
		]);
		return json({ success: true, data: summarizeSpkDataHealth(belumQc?.data, aktif?.data, { windowHari: WINDOW_DAYS }) });
	} catch (e: any) {
		console.error('[produksi/data-health] gagal membaca SPK:', e);
		throw error(502, e?.message || 'Gagal membaca kesehatan data SPK.');
	}
};
