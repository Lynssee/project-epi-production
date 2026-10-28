// src/lib/server/driverIdentity.ts
// SJH-17 — satu sumber "SJ ini milik driver ini?". Sebelumnya tiga identitas dibandingkan
// silang: teks bebas `driver`, `delegated_driver_id` (UUID fleet_drivers) vs karyawan.id (angka),
// dan _icontains yang membuat "ADI" cocok dengan "ADITYA…". Di sini: UUID fleet_drivers dibandingkan
// dengan UUID, teks dicocokkan PERSIS (trim, case-insensitive).

import { directusServerJson } from '$lib/server/directus';

export type DriverIdentity = {
	karyawanId: number | string;
	fleetDriverId: string | null;
	/** nama (lowercase, trimmed) yang dianggap identitas driver ini */
	names: string[];
	/** variasi penulisan untuk filter Directus `_in` (case-sensitive) */
	nameVariants: string[];
};

export async function resolveDriverIdentity(karyawan: { id: number | string; nama_karyawan: string }): Promise<DriverIdentity> {
	const r = await directusServerJson<{ data: any[] }>(
		`/items/fleet_drivers?filter[karyawan_id][_eq]=${encodeURIComponent(String(karyawan.id))}&fields=id,nama&limit=1`
	).catch((e) => {
		console.error('[driverIdentity] gagal baca fleet_drivers:', e instanceof Error ? e.message : e);
		return { data: [] as any[] };
	});
	const fd = r?.data?.[0] || null;
	const raw = [karyawan.nama_karyawan, fd?.nama].filter(Boolean).map((s) => String(s).trim()).filter(Boolean);
	const names = [...new Set(raw.map((s) => s.toLowerCase()))];
	const nameVariants = [...new Set(raw.flatMap((s) => [s, s.toUpperCase(), s.toLowerCase()]))];
	return { karyawanId: karyawan.id, fleetDriverId: fd?.id ?? null, names, nameVariants };
}

export function isSjDriver(
	sj: { driver?: string | null; delegated_driver_id?: string | null; delegated_user_id?: string | number | null },
	id: Pick<DriverIdentity, 'karyawanId' | 'fleetDriverId' | 'names'>
): boolean {
	if (id.fleetDriverId && sj.delegated_driver_id && String(sj.delegated_driver_id) === String(id.fleetDriverId)) return true;
	if (sj.delegated_user_id != null && String(sj.delegated_user_id) === String(id.karyawanId)) return true;
	// Cadangan SJ lama: teks cocok PERSIS dgn nama karyawan / nama fleet_drivers.
	const t = String(sj.driver ?? '').trim().toLowerCase();
	return !!t && id.names.includes(t);
}
