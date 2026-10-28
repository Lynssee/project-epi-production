// src/lib/server/aiProjectScope.ts
// SERVER-ONLY. Resolve proyek mana yang boleh dilihat tool Asisten AI untuk user
// tertentu — Fase 2 lanjutan, implementation_plan_Modul Asisten AI v3.1.md §Fase 2
// pertanyaan "boleh lihat proyek lain atau ketat hanya proyek sendiri?".
//
// Pola scoping SAMA dengan leaderScope di searchService.ts (dipakai Global Deep
// Search untuk entitas "Proyek"): view_all_projects (atau superadmin '*') = tak
// dibatasi; view_own_projects = hanya proyek tempat user jadi leader (leader_id
// atau nama leader cocok). User tanpa keduanya = tidak ada proyek yang boleh
// dilihat (array kosong, bukan tak-dibatasi) — supaya defaultnya aman.

import { directusServerJson } from './directus';

async function resolveLeaderProjectIds(email: string): Promise<number[]> {
	const karyawanQs = new URLSearchParams({
		filter: JSON.stringify({ email_company: { _eq: email.toLowerCase() } }),
		fields: 'id,nama_karyawan',
		limit: '1'
	});
	const karyawanRes = await directusServerJson<{ data: any[] }>(`/items/karyawan?${karyawanQs.toString()}`).catch(() => null);
	const karyawan = karyawanRes?.data?.[0];
	if (!karyawan) return [];

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
	const result = await directusServerJson<{ data: Array<{ id: number }> }>(`/items/projects?${qs.toString()}`).catch(() => null);
	return (result?.data || []).map((p) => p.id);
}

/**
 * @returns null bila tak dibatasi (admin/view_all_projects), array project id
 * (bisa kosong) bila dibatasi.
 */
export async function resolveProjectScope(permissions: string[], userEmail: string | null): Promise<number[] | null> {
	if (permissions.includes('*') || permissions.includes('view_all_projects')) return null;
	if (!permissions.includes('view_own_projects') || !userEmail) return [];
	return resolveLeaderProjectIds(userEmail);
}

/** true bila projectIds null (tak dibatasi) atau projectId ada di dalamnya. */
export function isProjectAllowed(projectIds: number[] | null, projectId: number): boolean {
	return projectIds === null || projectIds.includes(projectId);
}

/**
 * Proyek yang SEDANG aktif memakai satu equipment (belum di-demobilisasi),
 * lewat junction project_equipment. Equipment tanpa baris aktif dianggap aset
 * bersama/tak terikat proyek (mis. dispatch bengkel) — TIDAK dibatasi, sama
 * seperti perlakuan di goodsReceived/equipmentGate.ts.
 */
export async function resolveEquipmentActiveProjectIds(equipmentId: string): Promise<number[]> {
	const qs = new URLSearchParams({
		filter: JSON.stringify({ equipment_id: { _eq: equipmentId }, demobilization_date: { _null: true } }),
		fields: 'project_id',
		limit: '-1'
	});
	const res = await directusServerJson<{ data: Array<{ project_id: number | null }> }>(
		`/items/project_equipment?${qs.toString()}`
	).catch(() => null);
	return (res?.data || []).map((r) => r.project_id).filter((id): id is number => id != null);
}
