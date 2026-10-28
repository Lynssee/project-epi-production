// src/routes/api/driver/sj-readiness/+server.ts
// SJH-18 — kesiapan SJ untuk driver: langkah (Disetujui → Dicetak → Dimuat → Lolos satpam),
// kalimat "menunggu siapa", plat kendaraan, dan apakah tombol Berangkat sudah boleh.
// needsGate dihitung di SERVER (surat_jalan_category_config) agar tidak diduplikasi di klien.
// Hanya SJ yang didelegasikan ke driver login (id dari sesi, bukan payload). Query dipisah per relasi.

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { authenticateDriver } from '$lib/server/driver/driverGuard';
import { directusServerJson } from '$lib/server/directus';
import { evaluateBerangkat, sjButuhSatpam } from '$lib/server/driver/berangkatGuard';
import { sjReadiness } from '$lib/shared/sjReadiness';

export const GET: RequestHandler = async (event) => {
	const { driver } = await authenticateDriver(event);
	const ids = (event.url.searchParams.get('ids') || '')
		.split(',').map((s) => Number(s)).filter((n) => Number.isFinite(n) && n > 0).slice(0, 50);
	if (ids.length === 0) throw error(400, 'ids wajib diisi.');

	const sjs = (await directusServerJson<{ data: any[] }>(
		`/items/surat_jalan?filter[id][_in]=${ids.join(',')}&filter[delegated_driver_id][_eq]=${encodeURIComponent(driver.id)}` +
		`&fields=id,nomor_sj,status,print_count,approval_status,security_verified_at,track_stage,vehicle_id,category&limit=-1`
	).catch(() => ({ data: [] as any[] })))?.data || [];

	const vehicleIds = [...new Set(sjs.map((s) => s.vehicle_id).filter(Boolean))];
	const vehicles = vehicleIds.length
		? (await directusServerJson<{ data: any[] }>(`/items/fleet_kendaraan?filter[id][_in]=${vehicleIds.join(',')}&fields=id,nomor_polisi,merk,model&limit=-1`).catch(() => ({ data: [] as any[] })))?.data || []
		: [];
	const vById = new Map(vehicles.map((v) => [String(v.id), v]));

	// needsGate per kategori (cache lokal per request)
	const gateByCat = new Map<string, boolean>();
	const items = [];
	for (const sj of sjs) {
		const ck = String(sj.category ?? '');
		if (!gateByCat.has(ck)) gateByCat.set(ck, await sjButuhSatpam(sj.category));
		const needsGate = gateByCat.get(ck)!;
		const r = sjReadiness(sj, needsGate);
		const v = sj.vehicle_id ? vById.get(String(sj.vehicle_id)) : null;
		const blockers = evaluateBerangkat(sj, needsGate);
		items.push({
			id: sj.id,
			nomor_sj: sj.nomor_sj,
			steps: r.steps,
			next_hint: r.next_hint,
			can_berangkat: blockers.length === 0,
			berangkat_blockers: blockers,
			kendaraan: v ? { plat: v.nomor_polisi || null, nama: [v.merk, v.model].filter(Boolean).join(' ') || null } : null
		});
	}
	return json({ items });
};
