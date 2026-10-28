// src/lib/server/preventive/preventiveGuard.ts
// Guard bersama untuk endpoint /api/preventive/*: verifikasi Firebase token, resolve
// ke karyawan Directus, lalu resolve ke record personnel (operator_id P2H). Operator
// tidak pernah bisa mengklaim identitas orang lain — semua ditentukan dari sesi login,
// bukan payload klien. Mengikuti pola driverGuard.ts.

import { error, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail, type ServerKaryawan } from '$lib/server/ess/karyawan';
import { directusServerJson } from '$lib/server/directus';

export interface ServerPersonnel {
	id: string;
	name: string;
	karyawan_id: number | null;
}

/** Fase 0 (2026-07-16): personnel.karyawan_id -> karyawan.id resmi, dengan fallback nama
 * untuk personnel yang belum ditautkan admin HRD (lihat resolveOperatorId di preventive.ts). */
export async function resolvePersonnelForKaryawan(karyawan: ServerKaryawan): Promise<ServerPersonnel> {
	const byIdQuery = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawan.id),
		fields: 'id,name,karyawan_id',
		limit: '1'
	});
	const byId = await directusServerJson<{ data: ServerPersonnel[] }>(`/items/personnel?${byIdQuery.toString()}`);
	if (byId?.data?.[0]) return byId.data[0];

	const byNameQuery = new URLSearchParams({
		'filter[name][_eq]': karyawan.nama_karyawan,
		fields: 'id,name,karyawan_id',
		limit: '1'
	});
	const byName = await directusServerJson<{ data: ServerPersonnel[] }>(`/items/personnel?${byNameQuery.toString()}`);
	if (byName?.data?.[0]) return byName.data[0];

	const byNameFuzzyQuery = new URLSearchParams({
		'filter[name][_icontains]': karyawan.nama_karyawan.trim(),
		fields: 'id,name,karyawan_id',
		limit: '1'
	});
	const byNameFuzzy = await directusServerJson<{ data: ServerPersonnel[] }>(`/items/personnel?${byNameFuzzyQuery.toString()}`);
	if (byNameFuzzy?.data?.[0]) return byNameFuzzy.data[0];

	throw error(403, `Profil operator "${karyawan.nama_karyawan}" belum terhubung ke data personnel. Hubungi admin.`);
}

export async function authenticatePreventiveOperator(
	event: RequestEvent
): Promise<{ karyawan: ServerKaryawan; personnel: ServerPersonnel }> {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawanByEmail(user.email);
	if (!karyawan) {
		throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');
	}
	const personnel = await resolvePersonnelForKaryawan(karyawan);
	return { karyawan, personnel };
}
