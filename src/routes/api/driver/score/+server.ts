import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateDriver } from '$lib/server/driver/driverGuard';
import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';
import { computeOwnScore, flaggedFuelIds, COMPONENT_LABELS, type FuelRow } from '$lib/server/driver/driverScore';

// Skor driver BULAN BERJALAN milik driver yang login (hanya miliknya — id dari sesi, bukan payload).
// Rumus & bobot sama dengan tab "Skor Driver" di admin (fleet_settings.driver_score_weights).
// Hemat API: 1 query setelan + 4 query data; tidak ada data tulis.
const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();

export const GET: RequestHandler = async (event) => {
	const { driver } = await authenticateDriver(event);
	const today = todayJakarta();
	const ym = today.slice(0, 7);
	const [y, m] = ym.split('-').map(Number);
	const from = `${ym}-01`;
	const to = `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
	const back = new Date(y, m - 1, 1);
	back.setDate(back.getDate() - 60);
	const fromBack = `${back.getFullYear()}-${String(back.getMonth() + 1).padStart(2, '0')}-${String(back.getDate()).padStart(2, '0')}`;

	const [settingsRes, driverRes, tripsRes, checksRes, fuelRes] = await Promise.all([
		directusServerJson<{ data: { key: string; value: any }[] }>(
			`/items/fleet_settings?${qs({ 'filter[key][_in]': 'driver_score_weights,compliance_warn_days,bbm_toleransi_persen,konsumsi_default_km_per_liter', fields: 'key,value', limit: '-1' })}`
		).catch(() => ({ data: [] })),
		directusServerJson<{ data: { sim_berlaku_hingga: string | null }[] }>(
			`/items/fleet_drivers?${qs({ 'filter[id][_eq]': driver.id, fields: 'sim_berlaku_hingga', limit: '1' })}`
		),
		directusServerJson<{ data: { status: string | null }[] }>(
			`/items/fleet_trip_log?${qs({ 'filter[driver_id][_eq]': driver.id, 'filter[tanggal_berangkat][_between]': `${from}T00:00:00,${to}T23:59:59`, fields: 'id,status', limit: '-1' })}`
		),
		directusServerJson<{ data: { id: number }[] }>(
			`/items/fleet_vehicle_check?${qs({ 'filter[driver_id][_eq]': driver.id, 'filter[tanggal][_between]': `${from},${to}`, fields: 'id', limit: '-1' })}`
		),
		directusServerJson<{ data: (FuelRow & { driver_id: string | null })[] }>(
			`/items/fleet_fuel_log?${qs({ 'filter[driver_id][_eq]': driver.id, 'filter[tanggal][_between]': `${fromBack},${to}`, fields: 'id,vehicle_id,tanggal,liter,odometer,driver_id', limit: '-1' })}`
		)
	]);

	const set: Record<string, any> = {};
	for (const r of settingsRes.data || []) set[r.key] = r.value;

	const fuelAll = fuelRes.data || [];
	const vehicleIds = [...new Set(fuelAll.map((f) => String(f.vehicle_id)))];
	const baseline = new Map<string, number>();
	if (vehicleIds.length) {
		const v = await directusServerJson<{ data: { id: number; konsumsi_km_per_liter: number | null }[] }>(
			`/items/fleet_kendaraan?${qs({ 'filter[id][_in]': vehicleIds.join(','), fields: 'id,konsumsi_km_per_liter', limit: '-1' })}`
		).catch(() => ({ data: [] }));
		for (const k of v.data || []) if (k.konsumsi_km_per_liter) baseline.set(String(k.id), Number(k.konsumsi_km_per_liter));
	}

	const flagged = flaggedFuelIds(
		fuelAll,
		baseline,
		Number(set.konsumsi_default_km_per_liter) || 0,
		Number(set.bbm_toleransi_persen) || 20
	);
	const fuelInMonth = fuelAll.filter((f) => String(f.tanggal) >= from && String(f.tanggal) <= to);
	const warn = Array.isArray(set.compliance_warn_days) ? set.compliance_warn_days.map(Number).filter((n) => n > 0) : [30, 14, 7];

	const result = computeOwnScore({
		trips: tripsRes.data || [],
		checksCount: (checksRes.data || []).length,
		fuelInMonth,
		flaggedIds: flagged,
		simExpiry: driverRes.data?.[0]?.sim_berlaku_hingga ?? null,
		weights: set.driver_score_weights,
		warnDays: warn.length ? warn : [30, 14, 7]
	});

	return json({ periode: ym, labels: COMPONENT_LABELS, ...result });
};
