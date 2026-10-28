// src/lib/services/ess/skillGap.ts
// Client-side service ESS Skill Gap — selalu lewat /api/ess/skill-gap.

import { auth } from '$lib/firebase';

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

async function getIdToken(): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return user.getIdToken();
}

export async function getMySkillGap(): Promise<SkillGapResult> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/skill-gap', { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw new Error(`Gagal (${res.status})`);
	return res.json();
}
