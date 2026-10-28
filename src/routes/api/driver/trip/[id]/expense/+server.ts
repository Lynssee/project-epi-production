import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateDriver } from '$lib/server/driver/driverGuard';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { evaluateExpenseGates, failedHardGates } from '$lib/server/gates/expenseGate';

const JENIS_VALID = ['bbm', 'tol', 'parkir', 'lain'];
// Field di fleet_trip_log yang ditambah (increment) supaya rollup biaya bulanan admin
// (erp-epi-1/src/lib/services/fleetApi.js) tetap baca dari trip_log tanpa perlu diubah.
const TRIP_LOG_FIELD: Record<string, string> = {
	bbm: 'biaya_bbm',
	tol: 'biaya_tol',
	parkir: 'biaya_parkir',
	lain: 'biaya_lain'
};

/**
 * Catat satu baris biaya (BBM/tol/parkir/lain) untuk trip aktif. Ditulis dua tempat:
 * fleet_trip_expense (itemized, ada foto struk, untuk rekap Finance) dan increment
 * field biaya_* di fleet_trip_log yang sama (supaya rollup admin existing tetap benar).
 */
export const POST: RequestHandler = async (event) => {
	const { driver } = await authenticateDriver(event);
	const tripId = event.params.id;

	const form = await event.request.formData().catch(() => null);
	if (!form) throw error(400, 'Form data tidak valid.');

	const jenis = String(form.get('jenis') || '');
	const nominal = Number(form.get('nominal'));
	const catatan = String(form.get('catatan') || '').trim();
	const struk = form.get('foto_struk'); // File
	const odometerRaw = form.get('odometer');
	const odometer = odometerRaw ? Number(odometerRaw) : null;
	const fotoOdometer = form.get('foto_odometer'); // File

	if (!JENIS_VALID.includes(jenis)) throw error(400, 'Jenis biaya tidak valid.');
	if (!Number.isFinite(nominal) || nominal <= 0) throw error(400, 'Nominal tidak valid.');
	if (odometerRaw && (!Number.isFinite(odometer) || (odometer as number) < 0)) throw error(400, 'Odometer tidak valid.');

	const tripQuery = new URLSearchParams({
		'filter[id][_eq]': tripId,
		'filter[driver_id][_eq]': driver.id,
		limit: '1'
	});
	const tripRes = await directusServerJson<{ data: any[] }>(`/items/fleet_trip_log?${tripQuery.toString()}`);
	const trip = tripRes?.data?.[0];
	if (!trip) throw error(404, 'Trip tidak ditemukan atau bukan milik Anda.');
	if (trip.status !== 'active') throw error(409, 'Trip ini sudah selesai.');

	// fleet_trip_log TIDAK punya kolom project_id sendiri — turunkan dari fleet_bookings
	// bila trip ini berasal dari peminjaman (Fase 3 v2, 9 Sep 2026). Fetch dipisah
	// (Aturan #1/#2), non-fatal bila gagal/tidak ada booking.
	let tripProjectId: number | null = null;
	if (trip.booking_id) {
		const bookingRes = await directusServerJson<{ data: Array<{ project_id: number | null }> }>(
			`/items/fleet_bookings?filter[id][_eq]=${trip.booking_id}&fields=project_id&limit=1`
		).catch(() => null);
		tripProjectId = bookingRes?.data?.[0]?.project_id ?? null;
	}

	let strukId: string | null = null;
	if (struk instanceof File && struk.size > 0) {
		const uploadForm = new FormData();
		uploadForm.append('file', struk);
		const res = await directusServerUpload(uploadForm);
		if (!res.ok) throw error(502, 'Gagal mengunggah foto struk.');
		const uploaded = await res.json();
		strukId = uploaded?.data?.id ?? null;
	}

	let fotoOdometerId: string | null = null;
	if (fotoOdometer instanceof File && fotoOdometer.size > 0) {
		const uploadForm = new FormData();
		uploadForm.append('file', fotoOdometer);
		const res = await directusServerUpload(uploadForm);
		if (!res.ok) throw error(502, 'Gagal mengunggah foto odometer.');
		const uploaded = await res.json();
		fotoOdometerId = uploaded?.data?.id ?? null;
	}

	// Fase 2/3 v2 (9 Sep 2026): G_P2H_UNIT_LAPANGAN/G_SJ_KIRIM/G_BUKTI_BBM/G_BUKTI_STRUK.
	// G_BBM_VISIT tidak dievaluasi di sini — trip_log_id yang aktif SUDAH jadi jalur
	// alternatif sah untuk gate itu (lihat checkBbmVisitGate di visitGate.ts).
	const expenseGates = await evaluateExpenseGates({
		jenis,
		vehicleId: trip.vehicle_id || null,
		karyawanId: null,
		driverId: driver.id,
		fotoStrukId: strukId,
		odometer,
		fotoOdometerId
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

	const expense = await directusServerJson<{ data: any }>('/items/fleet_trip_expense', {
		method: 'POST',
		body: JSON.stringify({
			trip_log_id: tripId,
			jenis,
			nominal,
			foto_struk: strukId,
			catatan: catatan || null,
			waktu: new Date().toISOString(),
			// Fase 3 v2 (9 Sep 2026): sebelumnya endpoint ini TIDAK menulis project_id/
			// karyawan_id/mode sama sekali (temuan §1.7 rencana) — tambahkan sekalian.
			project_id: tripProjectId,
			karyawan_id: driver.karyawan_id ? String(driver.karyawan_id) : null,
			mode: 'proyek',
			odometer,
			foto_odometer: fotoOdometerId
		})
	});

	const field = TRIP_LOG_FIELD[jenis];
	const currentValue = Number(trip[field] ?? 0);
	await directusServerJson(`/items/fleet_trip_log/${tripId}`, {
		method: 'PATCH',
		body: JSON.stringify({ [field]: currentValue + nominal })
	});

	return json({ record: expense?.data ?? expense });
};
