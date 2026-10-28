// src/lib/server/ess/mentor.ts
// Fase 4.3 LMS v2.0: dashboard mentor self-service — mentor melihat mentee yang ditugaskan
// dan mengisi evaluasi akhir probation sendiri (field sama dengan yang dipakai HR di
// HrdOnboardingDetail.svelte: skor_akhir/rekomendasi/catatan — satu sumber kebenaran).

import { directusServerJson } from '$lib/server/directus';

export interface MenteeSummary {
	onboardingId: number;
	karyawanId: number;
	namaKaryawan: string;
	jenis: string;
	status: string;
	progress: number;
	skorAkhir: number | null;
	rekomendasi: string | null;
	totalTasks: number;
	doneTasks: number;
}

function unwrapId(value: any): number | null {
	if (value == null) return null;
	return typeof value === 'object' ? (value.id ?? null) : value;
}

export async function listMenteesForMentor(mentorKaryawanId: number): Promise<MenteeSummary[]> {
	const query = new URLSearchParams({
		'filter[mentor_id][_eq]': String(mentorKaryawanId),
		fields: 'id,karyawan_id.id,karyawan_id.nama_karyawan,template_used,status,progress,skor_akhir,rekomendasi',
		sort: '-id',
		limit: '100'
	});
	const casesRes = await directusServerJson<{ data: any[] }>(`/items/onboarding_case?${query.toString()}`);
	const cases = casesRes?.data || [];
	if (cases.length === 0) return [];

	const caseIds = cases.map((c) => c.id);
	const tasksRes = await directusServerJson<{ data: Array<{ onboarding_id: any; completed: boolean }> }>(
		`/items/onboarding_task?filter[onboarding_id][_in]=${caseIds.join(',')}&fields=onboarding_id,completed&limit=-1`
	);
	const tasks = tasksRes?.data || [];
	const taskCountByCase = new Map<number, { total: number; done: number }>();
	for (const t of tasks) {
		const cid = unwrapId(t.onboarding_id) as number;
		const cur = taskCountByCase.get(cid) || { total: 0, done: 0 };
		cur.total++;
		if (t.completed) cur.done++;
		taskCountByCase.set(cid, cur);
	}

	return cases.map((c) => ({
		onboardingId: c.id,
		karyawanId: unwrapId(c.karyawan_id) as number,
		namaKaryawan: c.karyawan_id?.nama_karyawan || '-',
		jenis: c.template_used || 'Onboarding',
		status: c.status,
		progress: c.progress || 0,
		skorAkhir: c.skor_akhir ?? null,
		rekomendasi: c.rekomendasi ?? null,
		totalTasks: taskCountByCase.get(c.id)?.total ?? 0,
		doneTasks: taskCountByCase.get(c.id)?.done ?? 0
	}));
}

/** Mentor mengisi evaluasi akhir untuk mentee-nya sendiri. Hanya boleh untuk case miliknya. */
export async function submitMentorEvaluation(
	mentorKaryawanId: number,
	onboardingId: number,
	skorAkhir: number,
	rekomendasi: string,
	catatan: string | null
): Promise<void> {
	const query = new URLSearchParams({ 'filter[id][_eq]': String(onboardingId), 'filter[mentor_id][_eq]': String(mentorKaryawanId), fields: 'id', limit: '1' });
	const owned = await directusServerJson<{ data: Array<{ id: number }> }>(`/items/onboarding_case?${query.toString()}`);
	if (!owned?.data?.length) throw new Error('Onboarding case tidak ditemukan atau Anda bukan mentor untuk case ini.');
	if (skorAkhir < 0 || skorAkhir > 100) throw new Error('Skor harus 0-100.');

	await directusServerJson(`/items/onboarding_case/${onboardingId}`, {
		method: 'PATCH',
		body: JSON.stringify({
			skor_akhir: skorAkhir,
			rekomendasi,
			catatan,
			evaluasi_oleh: 'mentor-self-service',
			evaluasi_pada: new Date().toISOString()
		})
	});
}
