// src/lib/server/ess/trainingSkill.ts
// F4 Roadmap E-Learning: derivasi training_karyawan_skill saat enrollment Lulus.
// Port dari hrdTrainingSkillApi.js (erp-epi-1 admin) — logika sama, dijalankan server-side ESS.

import { directusServerJson } from '$lib/server/directus';

const LEVEL_RANK: Record<string, number> = { Dasar: 1, Menengah: 2, Lanjutan: 3 };

interface ProgramSkillRow {
	id: number;
	program_id: number;
	skill_id: number | { id: number };
	level_diberikan: string | null;
}

interface KaryawanSkillRow {
	id: number;
	karyawan_id: number | { id: number };
	skill_id: number | { id: number };
	level: string;
	sumber_enrollment_id: number | null;
	expired: string | null;
}

function unwrapId(value: any): number | null {
	if (value == null) return null;
	return typeof value === 'object' ? (value.id ?? null) : value;
}

async function fetchProgramSkills(programId: number): Promise<ProgramSkillRow[]> {
	const query = new URLSearchParams({
		limit: '-1',
		fields: 'id,program_id,skill_id,level_diberikan',
		filter: JSON.stringify({ program_id: { _eq: programId } })
	});
	const result = await directusServerJson<{ data: ProgramSkillRow[] }>(`/items/training_program_skill?${query.toString()}`);
	return result?.data || [];
}

/**
 * Dipanggil setelah enrollment Lulus & sertifikat terbit: upsert training_karyawan_skill
 * untuk setiap skill yang dipetakan ke program (ambil level tertinggi bila karyawan sudah
 * punya skill yang sama dari training lain — sama seperti perilaku admin).
 */
export async function deriveSkillsFromEnrollment(params: {
	enrollmentId: number;
	karyawanId: number;
	programId: number;
	sertifikatExpired: string | null;
}): Promise<void> {
	const programSkills = await fetchProgramSkills(params.programId);
	if (programSkills.length === 0) return;

	const existingQuery = new URLSearchParams({
		limit: '-1',
		filter: JSON.stringify({ karyawan_id: { _eq: params.karyawanId } })
	});
	const existingRes = await directusServerJson<{ data: KaryawanSkillRow[] }>(`/items/training_karyawan_skill?${existingQuery.toString()}`);
	const existing = existingRes?.data || [];

	for (const ps of programSkills) {
		const skillId = unwrapId(ps.skill_id);
		if (!skillId) continue;
		const level = ps.level_diberikan || 'Dasar';
		const found = existing.find((e) => unwrapId(e.skill_id) === skillId);

		if (found && (LEVEL_RANK[found.level] || 0) >= (LEVEL_RANK[level] || 0)) {
			continue;
		}

		const payload = {
			karyawan_id: params.karyawanId,
			skill_id: skillId,
			level,
			sumber_enrollment_id: params.enrollmentId,
			expired: params.sertifikatExpired
		};

		if (found) {
			await directusServerJson(`/items/training_karyawan_skill/${found.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
		} else {
			await directusServerJson('/items/training_karyawan_skill', { method: 'POST', body: JSON.stringify(payload) });
		}
	}
}

export interface MySkillRecord {
	id: number;
	skill_id: number;
	skill_nama: string;
	skill_kategori: string | null;
	level: string;
	expired: string | null;
}

/** Skill milik karyawan untuk ditampilkan di profil ESS. */
export async function listMySkills(karyawanId: number): Promise<MySkillRecord[]> {
	const query = new URLSearchParams({
		limit: '-1',
		fields: 'id,skill_id.id,skill_id.nama,skill_id.kategori,level,expired',
		filter: JSON.stringify({ karyawan_id: { _eq: karyawanId } })
	});
	const result = await directusServerJson<{ data: any[] }>(`/items/training_karyawan_skill?${query.toString()}`);
	return (result?.data || []).map((row) => ({
		id: row.id,
		skill_id: unwrapId(row.skill_id) as number,
		skill_nama: row.skill_id?.nama ?? '-',
		skill_kategori: row.skill_id?.kategori ?? null,
		level: row.level,
		expired: row.expired
	}));
}
