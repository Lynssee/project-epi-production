// src/lib/server/driver/driverGuard.ts
// Guard bersama untuk endpoint /api/driver/*: verifikasi Firebase token, resolve ke
// karyawan Directus, lalu resolve ke record fleet_drivers miliknya. Driver tidak pernah
// bisa mengklaim driver_id lain — semua ditentukan dari sesi login, bukan payload klien.

import { error, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail, type ServerKaryawan } from '$lib/server/ess/karyawan';
import { directusServerJson } from '$lib/server/directus';

export interface ServerDriver {
	id: string;
	nama: string;
	karyawan_id: string | null;
	status: string | null;
}

export async function resolveDriverByKaryawanId(karyawanId: number): Promise<ServerDriver | null> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		fields: 'id,nama,karyawan_id,status',
		limit: '1'
	});
	const result = await directusServerJson<{ data: ServerDriver[] }>(`/items/fleet_drivers?${query.toString()}`);
	return result?.data?.[0] || null;
}

export async function authenticateDriver(
	event: RequestEvent
): Promise<{ user: Awaited<ReturnType<typeof requireUser>>; karyawan: ServerKaryawan; driver: ServerDriver }> {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawanByEmail(user.email);
	if (!karyawan) {
		throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');
	}
	const driver = await resolveDriverByKaryawanId(karyawan.id);
	if (!driver) {
		throw error(403, 'Akun karyawan ini belum tertaut ke data driver (fleet_drivers). Hubungi admin Fleet.');
	}
	return { user, karyawan, driver };
}
