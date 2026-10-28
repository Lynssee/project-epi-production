// src/lib/server/siteCheckinPeran.ts
// Paket 04 Site Visit Release §3.6 — ekstrak logika peran-per-proyek dari
// my-projects/+server.ts (union leader_id / manpower_leader / manpower assignment) supaya bisa
// dipakai ulang untuk gate server-side single-project (project-koordinat/+server.ts), tanpa
// mengambil SELURUH daftar proyek karyawan hanya untuk mengecek satu ID.

import { directusServerJson } from '$lib/server/directus';

export type PeranProyek = 'leader' | 'manpower_leader' | 'wakil_leader' | 'anggota_regu' | 'kunjungan';

interface KaryawanRef {
	id: number | string;
	nama_karyawan?: string | null;
}

interface UserRef {
	email?: string | null;
}

/**
 * Peran karyawan pada SATU proyek tertentu — union yang sama seperti my-projects/+server.ts
 * (leader_id/nama persis, manpower_leader_id/wakil, manpower_assignment aktif). Proyek yang
 * tidak match salah satu dari itu dianggap 'kunjungan' (peran paling longgar, tanpa hak menulis
 * koordinat — lihat pemakai di project-koordinat/+server.ts).
 */
export async function getPeranProyek(karyawan: KaryawanRef, user: UserRef, projectId: number): Promise<PeranProyek> {
	const projRes = await directusServerJson<{
		data: { id: number; leader_id: string | number | null; leader: string | null; manpower_leader_id: string | number | null; manpower_leader_wakil_id: string | number | null } | null;
	}>(`/items/projects/${projectId}?fields=id,leader_id,leader,manpower_leader_id,manpower_leader_wakil_id`).catch(() => null);
	const project = projRes?.data;
	if (!project) return 'kunjungan';

	// 1) Project Leader — leader_id persis, atau (fallback) nama leader cocok PERSIS (bukan
	// _icontains longgar — §3.7 mengetatkan aturan ini di my-projects juga).
	if (String(project.leader_id ?? '') === String(karyawan.id)) return 'leader';
	const namaKaryawan = (karyawan.nama_karyawan || '').trim().toLowerCase();
	if (!project.leader_id && namaKaryawan && (project.leader || '').trim().toLowerCase() === namaKaryawan) {
		return 'leader';
	}

	// 2) Manpower Leader / Wakil + 3) Anggota regu (manpower_assignment aktif) — butuh manpower_id
	// karyawan ini dulu.
	const orConditions: any[] = [];
	if (user.email) orConditions.push({ user_email: { _eq: user.email.toLowerCase() } });
	if (karyawan.id) orConditions.push({ karyawan_id: { _eq: String(karyawan.id) } });
	if (orConditions.length === 0) return 'kunjungan';

	const mQuery = new URLSearchParams({ fields: 'id', filter: JSON.stringify({ _or: orConditions }), limit: '1' });
	const mRes = await directusServerJson<{ data: { id: number }[] }>(`/items/manpower?${mQuery.toString()}`).catch(() => null);
	const manpowerId = mRes?.data?.[0]?.id;
	if (!manpowerId) return 'kunjungan';

	if (String(project.manpower_leader_id ?? '') === String(manpowerId)) return 'manpower_leader';
	if (String(project.manpower_leader_wakil_id ?? '') === String(manpowerId)) return 'wakil_leader';

	const assignQuery = new URLSearchParams({
		filter: JSON.stringify({ manpower_id: { _eq: String(manpowerId) }, project_id: { _eq: projectId }, status: { _eq: 'aktif' } }),
		fields: 'id',
		limit: '1'
	});
	const assignRes = await directusServerJson<{ data: { id: number }[] }>(`/items/manpower_assignment?${assignQuery.toString()}`).catch(() => null);
	if ((assignRes?.data || []).length > 0) return 'anggota_regu';

	return 'kunjungan';
}
