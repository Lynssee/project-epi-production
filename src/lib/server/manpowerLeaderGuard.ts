// src/lib/server/manpowerLeaderGuard.ts
// Guard untuk endpoint yang hanya boleh dipakai Manpower Leader.
// Dokumen: erp-epi-1/docs/rencana-manpower-leader.md
//
// Dua lapis, dan keduanya WAJIB — role saja tidak cukup:
//   1. akun terpetakan ke baris `manpower` (lewat manpower.user_email);
//   2. orang itu benar-benar memegang kursi Manpower Leader/Wakil DI PROYEK yang diminta.
// Lapis 2 yang penting: role tidak mengikat seseorang ke proyek tertentu, kursi mengikat.
// Tanpa itu, satu manpower leader bisa mengabsenkan regu proyek orang lain.

import { error, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';

export interface ServerManpower {
	id: number;
	nama: string;
	user_email?: string | null;
}

const idOf = (v: any) => (v && typeof v === 'object' ? v.id : v);

/** Resolve akun login → baris `manpower`. Email dulu, karyawan_id sebagai cadangan. */
export async function resolveManpowerByEmail(email: string | null | undefined): Promise<ServerManpower | null> {
	if (!email) return null;
	const q = new URLSearchParams({
		'filter[user_email][_eq]': email.toLowerCase(),
		fields: 'id,nama,user_email',
		limit: '1'
	});
	const res = await directusServerJson<{ data: ServerManpower[] }>(`/items/manpower?${q.toString()}`);
	return res?.data?.[0] || null;
}

/**
 * Autentikasi + pastikan pemanggil memegang kursi lapangan di proyek ini.
 * @throws 401/403 bila tidak memenuhi.
 */
export async function authenticateManpowerLeader(
	event: RequestEvent,
	projectId: number
): Promise<{ manpower: ServerManpower; project: any }> {
	const user = await requireUser(event);

	const manpower = await resolveManpowerByEmail(user.email);
	if (!manpower) {
		throw error(403, 'Akun ini belum tertaut ke data manpower. Minta HRD mengisi "Email akun" pada data Anda.');
	}

	const project = await directusServerJson<{ data: any }>(
		`/items/projects/${projectId}?fields=id,name,geo_lat,geo_lng,geo_radius_m,manpower_leader_id,manpower_leader_wakil_id`
	).then((r) => r?.data);

	if (!project) throw error(404, 'Proyek tidak ditemukan.');

	const pegangKursi =
		String(idOf(project.manpower_leader_id)) === String(manpower.id) ||
		String(idOf(project.manpower_leader_wakil_id)) === String(manpower.id);

	if (!pegangKursi) {
		throw error(403, 'Anda bukan Manpower Leader / Wakil di proyek ini.');
	}

	return { manpower, project };
}
