import directus from './directus';
import { readItems } from '@directus/sdk';

// ── Skill Matrix (read-only, lapangan) ──────────────────────────────────
// Lapangan tidak menilai/mengubah skill (itu wewenang HRD di erp-epi-1,
// lihat hrdSkillMatrixApi.js) — di sini cuma tampil untuk profil pekerja &
// filter "cari berdasarkan skill" saat PL memilih pekerja.

export interface ManpowerSkillView {
	id: number;
	level: string;
	skill_nama: string;
	skill_kategori: string | null;
}

const LEVEL_LABEL: Record<string, string> = {
	pemula: 'Pemula',
	kompeten: 'Kompeten',
	mahir: 'Mahir',
	expert: 'Expert'
};

export function levelLabel(level: string): string {
	return LEVEL_LABEL[level] || level;
}

/** Skill seorang manpower (dipanggil saat kartu dibuka, bukan sekaligus semua orang). */
export async function getSkillsForManpower(manpowerId: number): Promise<ManpowerSkillView[]> {
	try {
		const rows = (await directus.request(
			readItems('manpower_skill', {
				fields: ['id', 'level', 'skill_id.nama', 'skill_id.kategori'],
				filter: { manpower_id: { _eq: manpowerId } },
				limit: -1
			})
		)) as any[];
		return (rows || []).map((r) => ({
			id: r.id,
			level: r.level,
			skill_nama: r.skill_id?.nama || '-',
			skill_kategori: r.skill_id?.kategori || null
		}));
	} catch (e) {
		console.warn('getSkillsForManpower gagal:', (e as any)?.message);
		return [];
	}
}

/** Master skill aktif — untuk dropdown filter "cari berdasarkan skill". */
export async function getActiveSkillMaster(): Promise<{ id: number; nama: string }[]> {
	try {
		const rows = (await directus.request(
			readItems('skill_master', {
				fields: ['id', 'nama'],
				filter: { aktif: { _eq: true } },
				sort: ['nama'],
				limit: -1
			})
		)) as any[];
		return rows || [];
	} catch (e) {
		console.warn('getActiveSkillMaster gagal:', (e as any)?.message);
		return [];
	}
}

/** Set manpower_id yang punya skill tertentu — dasar filter "cari berdasarkan skill". */
export async function getManpowerIdsBySkill(skillId: number): Promise<Set<number>> {
	try {
		const rows = (await directus.request(
			readItems('manpower_skill', {
				fields: ['manpower_id'],
				filter: { skill_id: { _eq: skillId } },
				limit: -1
			})
		)) as any[];
		return new Set((rows || []).map((r) => Number(r.manpower_id)));
	} catch (e) {
		console.warn('getManpowerIdsBySkill gagal:', (e as any)?.message);
		return new Set();
	}
}
