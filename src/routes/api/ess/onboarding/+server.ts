import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getMyOnboardingCase, listTasksForCase, submitTaskEvidence, submitMentorRating } from '$lib/server/ess/onboarding';
import { directusServerUpload } from '$lib/server/directus';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const kasus = await getMyOnboardingCase(karyawan.id);
	if (!kasus) return json({ kasus: null, tasks: [] });

	const tasks = await listTasksForCase(kasus.id);
	return json({ kasus, tasks });
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const formData = await event.request.formData();
	const onboardingId = Number(formData.get('onboardingId'));
	const taskId = Number(formData.get('taskId'));
	const catatan = (formData.get('catatan') as string) || null;
	const file = formData.get('file') as File | null;
	if (!onboardingId || !taskId) throw error(400, 'onboardingId dan taskId wajib diisi');

	let fileUuid: string | null = null;
	if (file && file.size > 0) {
		const uploadForm = new FormData();
		uploadForm.append('file', file);
		const res = await directusServerUpload(uploadForm);
		if (!res.ok) throw error(500, `Gagal upload file (${res.status})`);
		const body = await res.json();
		fileUuid = body?.data?.id || null;
	}

	try {
		const task = await submitTaskEvidence(karyawan.id, onboardingId, taskId, fileUuid, catatan);
		return json({ success: true, task });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal submit task');
	}
};

/** Penilaian dua arah (Fase 4.3): mentee menilai mentor lewat body JSON { onboardingId, skorMentor, catatanMentor }. */
export const PATCH: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json();
	const onboardingId = Number(body.onboardingId);
	const skorMentor = Number(body.skorMentor);
	const catatanMentor = body.catatanMentor ? String(body.catatanMentor) : null;
	if (!Number.isFinite(onboardingId) || !Number.isFinite(skorMentor)) throw error(400, 'onboardingId dan skorMentor wajib diisi.');

	try {
		const kasus = await submitMentorRating(karyawan.id, onboardingId, skorMentor, catatanMentor);
		return json({ kasus });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal menilai mentor.');
	}
};
