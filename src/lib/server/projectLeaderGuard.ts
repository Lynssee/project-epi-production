// src/lib/server/projectLeaderGuard.ts
// Guard untuk endpoint PL Dashboard (Fase 1, blueprint modul maintenance 18 Agu 2026).
// Pola sama dengan manpowerLeaderGuard.ts — dua lapis, keduanya WAJIB:
//   1. akun terpetakan ke baris `karyawan` (lewat karyawan.email_company);
//   2. proyek yang diminta benar-benar dipimpin orang itu (projects.leader_id,
//      fallback nama projects.leader — sama seperti resolveLeaderProjectIds di aiProjectScope.ts).
// Role saja tidak cukup: role tidak mengikat orang ke proyek tertentu, kursi leader_id yang mengikat.

import { error, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';

export interface ServerKaryawan {
	id: number;
	nama_karyawan: string;
	email_company?: string | null;
}

export async function resolveKaryawanByEmail(email: string | null | undefined): Promise<ServerKaryawan | null> {
	if (!email) return null;
	const qs = new URLSearchParams({
		filter: JSON.stringify({ email_company: { _eq: email.toLowerCase() } }),
		fields: 'id,nama_karyawan,email_company',
		limit: '1'
	});
	const res = await directusServerJson<{ data: ServerKaryawan[] }>(`/items/karyawan?${qs.toString()}`);
	return res?.data?.[0] || null;
}

/** Semua project id yang dipimpin karyawan ini (leader_id, fallback nama). */
export async function resolveLedProjectIds(karyawan: ServerKaryawan): Promise<number[]> {
	const qs = new URLSearchParams({
		filter: JSON.stringify({
			_or: [
				{ leader_id: { _eq: karyawan.id } },
				{ co_leader_id: { _eq: karyawan.id } },
				{ leader: { _icontains: karyawan.nama_karyawan } },
				{ co_leader: { _icontains: karyawan.nama_karyawan } }
			]
		}),
		fields: 'id',
		limit: '-1'
	});
	const res = await directusServerJson<{ data: Array<{ id: number }> }>(`/items/projects?${qs.toString()}`).catch(() => null);
	return (res?.data || []).map((p) => p.id);
}

/**
 * Autentikasi + pastikan pemanggil memimpin proyek ini.
 * @throws 401/403/404 bila tidak memenuhi.
 */
export async function authenticateProjectLeader(
	event: RequestEvent,
	projectId: number
): Promise<{ karyawan: ServerKaryawan; project: any }> {
	const user = await requireUser(event);

	const karyawan = await resolveKaryawanByEmail(user.email);
	if (!karyawan) {
		throw error(403, 'Akun ini belum tertaut ke data karyawan. Minta HRD mengisi "Email Perusahaan" pada data Anda.');
	}

	const project = await directusServerJson<{ data: any }>(
		`/items/projects/${projectId}?fields=id,name,leader_id,leader,co_leader_id,co_leader`
	).then((r) => r?.data);

	if (!project) throw error(404, 'Proyek tidak ditemukan.');

	const memimpin =
		String(project.leader_id) === String(karyawan.id) ||
		String(project.co_leader_id) === String(karyawan.id) ||
		(!!project.leader && project.leader.toLowerCase().includes(karyawan.nama_karyawan.toLowerCase())) ||
		(!!project.co_leader && project.co_leader.toLowerCase().includes(karyawan.nama_karyawan.toLowerCase()));

	if (!memimpin) {
		throw error(403, 'Anda bukan Project Leader di proyek ini.');
	}

	return { karyawan, project };
}

/**
 * Autentikasi + pastikan proyek pemilik equipment/WO ini ada di daftar proyek yang dipimpin.
 * Dipakai endpoint approve/reject yang inputnya work_order/mekanik_activity (bukan project_id
 * langsung) — resolve project_id dulu lewat project_equipment, baru cek kepemimpinan.
 */
export async function authenticateProjectLeaderForEquipment(
	event: RequestEvent,
	equipmentId: string
): Promise<{ karyawan: ServerKaryawan; projectIds: number[] }> {
	const user = await requireUser(event);

	const karyawan = await resolveKaryawanByEmail(user.email);
	if (!karyawan) {
		throw error(403, 'Akun ini belum tertaut ke data karyawan. Minta HRD mengisi "Email Perusahaan" pada data Anda.');
	}

	const ledProjectIds = await resolveLedProjectIds(karyawan);
	if (!ledProjectIds.length) {
		throw error(403, 'Anda tidak memimpin proyek manapun.');
	}

	const qs = new URLSearchParams({
		filter: JSON.stringify({ equipment_id: { _eq: equipmentId }, demobilization_date: { _null: true } }),
		fields: 'project_id',
		limit: '-1'
	});
	const res = await directusServerJson<{ data: Array<{ project_id: number | null }> }>(
		`/items/project_equipment?${qs.toString()}`
	).catch(() => null);
	const equipmentProjectIds = (res?.data || []).map((r) => r.project_id).filter((id): id is number => id != null);

	const overlap = equipmentProjectIds.filter((id) => ledProjectIds.includes(id));
	if (!overlap.length) {
		throw error(403, 'Equipment/laporan ini bukan bagian dari proyek yang Anda pimpin.');
	}

	return { karyawan, projectIds: overlap };
}

/**
 * Autentikasi + pastikan pekerja (manpower) ini punya penugasan aktif (manpower_assignment,
 * status='aktif') pada salah satu proyek yang dipimpin pemanggil. Dipakai aksi Benahi Inline
 * (Gate Transparan & Popup Benahi Data, Fase 3) — leader hanya boleh membenahi data pekerja
 * timnya sendiri, bukan pekerja proyek lain.
 */
export async function authenticateProjectLeaderForManpower(
	event: RequestEvent,
	manpowerId: number
): Promise<{ karyawan: ServerKaryawan; projectIds: number[] }> {
	const user = await requireUser(event);

	const karyawan = await resolveKaryawanByEmail(user.email);
	if (!karyawan) {
		throw error(403, 'Akun ini belum tertaut ke data karyawan. Minta HRD mengisi "Email Perusahaan" pada data Anda.');
	}

	const ledProjectIds = await resolveLedProjectIds(karyawan);
	if (!ledProjectIds.length) {
		throw error(403, 'Anda tidak memimpin proyek manapun.');
	}

	const qs = new URLSearchParams({
		filter: JSON.stringify({ manpower_id: { _eq: manpowerId }, status: { _eq: 'aktif' } }),
		fields: 'project_id',
		limit: '-1'
	});
	const res = await directusServerJson<{ data: Array<{ project_id: number | null }> }>(
		`/items/manpower_assignment?${qs.toString()}`
	).catch(() => null);
	const assignmentProjectIds = (res?.data || []).map((r) => r.project_id).filter((id): id is number => id != null);

	const overlap = assignmentProjectIds.filter((id) => ledProjectIds.includes(id));
	if (!overlap.length) {
		throw error(403, 'Pekerja ini tidak sedang ditugaskan di proyek yang Anda pimpin.');
	}

	return { karyawan, projectIds: overlap };
}

/**
 * Autentikasi + pastikan baris project_budgets ini milik proyek yang dipimpin pemanggil.
 * Dipakai aksi Benahi Inline C (usul tautan barang, Fase 3).
 */
export async function authenticateProjectLeaderForBudgetItem(
	event: RequestEvent,
	projectBudgetId: number
): Promise<{ karyawan: ServerKaryawan; projectBudget: { id: number; project_id: number | null } }> {
	const user = await requireUser(event);

	const karyawan = await resolveKaryawanByEmail(user.email);
	if (!karyawan) {
		throw error(403, 'Akun ini belum tertaut ke data karyawan. Minta HRD mengisi "Email Perusahaan" pada data Anda.');
	}

	const ledProjectIds = await resolveLedProjectIds(karyawan);
	if (!ledProjectIds.length) {
		throw error(403, 'Anda tidak memimpin proyek manapun.');
	}

	const projectBudget = await directusServerJson<{ data: { id: number; project_id: number | null } }>(
		`/items/project_budgets/${projectBudgetId}?fields=id,project_id`
	).then((r) => r?.data);

	if (!projectBudget) throw error(404, 'Item RAB tidak ditemukan.');
	if (!projectBudget.project_id || !ledProjectIds.includes(Number(projectBudget.project_id))) {
		throw error(403, 'Item RAB ini bukan bagian dari proyek yang Anda pimpin.');
	}

	return { karyawan, projectBudget };
}
