// src/lib/server/ess/skillGap.ts
// ESS #4 backlog (KPI x Payroll TAJAM v2) — Skill Gap: skill wajib jabatan vs skill yang
// dimiliki karyawan. SENGAJA DUPLIKAT logika hitungCakupanKompetensi dari
// erp-epi-1/src/lib/services/hrdSkillKpiApi.js (repo terpisah, tidak bisa import lintas-repo) —
// rumus HARUS tetap sinkron manual dgn sumber itu kalau salah satu diubah.

import { directusServerJson } from '$lib/server/directus';

const LEVEL_RANK: Record<string, number> = { Dasar: 1, Menengah: 2, Lanjutan: 3 };

export interface SkillGapItem {
	namaSkill: string;
	kategori: string;
	levelMinimum: string;
	levelDimiliki: string | null;
	bobot: number;
	status: 'terpenuhi' | 'kedaluwarsa' | 'level_kurang' | 'belum';
}

export interface SkillGapResult {
	persen: number | null;
	terpenuhi: number;
	total: number;
	detail: SkillGapItem[];
	kurang: SkillGapItem[];
}

const EMPTY: SkillGapResult = { persen: null, terpenuhi: 0, total: 0, detail: [], kurang: [] };

export async function getSkillGapForKaryawan(karyawanId: number, jabatanId: number | null): Promise<SkillGapResult> {
	if (!jabatanId) return EMPTY;

	const reqQuery = new URLSearchParams({
		'filter[position_id][_eq]': String(jabatanId),
		'filter[wajib][_eq]': 'true',
		'filter[status][_eq]': 'aktif',
		fields: 'id,skill_id.id,skill_id.nama,skill_id.kategori,level_minimum,bobot',
		limit: '-1'
	});
	const requirements = (await directusServerJson<{ data: any[] }>(`/items/posisi_skill_requirement?${reqQuery.toString()}`))?.data || [];
	if (requirements.length === 0) return EMPTY;

	const ownedQuery = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		fields: 'skill_id,level,expired',
		limit: '-1'
	});
	const owned = (await directusServerJson<{ data: any[] }>(`/items/training_karyawan_skill?${ownedQuery.toString()}`))?.data || [];

	const now = new Date();
	const ownedBySkill = new Map<string, any>();
	const expiredBySkill = new Map<string, any>();
	for (const os of owned) {
		const sid = String(typeof os.skill_id === 'object' ? os.skill_id?.id : os.skill_id);
		if (!sid || sid === 'null' || sid === 'undefined') continue;
		const isExpired = Boolean(os.expired) && new Date(os.expired) < now;
		if (isExpired) {
			const prevExp = expiredBySkill.get(sid);
			if (!prevExp || (LEVEL_RANK[os.level] || 0) > (LEVEL_RANK[prevExp.level] || 0)) expiredBySkill.set(sid, os);
			continue;
		}
		const prev = ownedBySkill.get(sid);
		if (!prev || (LEVEL_RANK[os.level] || 0) > (LEVEL_RANK[prev.level] || 0)) ownedBySkill.set(sid, os);
	}

	const detail: SkillGapItem[] = [];
	const kurang: SkillGapItem[] = [];
	let bobotTerpenuhi = 0;
	let bobotTotal = 0;
	let terpenuhi = 0;

	for (const req of requirements) {
		const sid = String(req.skill_id?.id ?? req.skill_id);
		const bobot = Number(req.bobot) > 0 ? Number(req.bobot) : 1;
		const minRank = LEVEL_RANK[req.level_minimum] || 1;
		const ownedRow = ownedBySkill.get(sid) || null;
		const ownedRank = ownedRow ? LEVEL_RANK[ownedRow.level] || 0 : 0;
		const kedaluwarsaRow = expiredBySkill.get(sid) || null;

		bobotTotal += bobot;
		const ok = ownedRank >= minRank;
		if (ok) {
			bobotTerpenuhi += bobot;
			terpenuhi += 1;
		}

		const status: SkillGapItem['status'] = ok ? 'terpenuhi' : kedaluwarsaRow ? 'kedaluwarsa' : ownedRow ? 'level_kurang' : 'belum';

		const row: SkillGapItem = {
			namaSkill: req.skill_id?.nama || `Skill #${sid}`,
			kategori: req.skill_id?.kategori || '',
			levelMinimum: req.level_minimum || 'Dasar',
			levelDimiliki: ownedRow?.level || null,
			bobot,
			status
		};
		detail.push(row);
		if (!ok) kurang.push(row);
	}

	return {
		persen: bobotTotal > 0 ? Math.round((bobotTerpenuhi / bobotTotal) * 1000) / 10 : null,
		terpenuhi,
		total: requirements.length,
		detail,
		kurang
	};
}
