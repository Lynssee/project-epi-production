import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { submitMentorEvaluation } from '$lib/server/ess/mentor';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json();
	const onboardingId = Number(body.onboardingId);
	const skorAkhir = Number(body.skorAkhir);
	const rekomendasi = String(body.rekomendasi || '');
	const catatan = body.catatan ? String(body.catatan) : null;
	if (!Number.isFinite(onboardingId) || !Number.isFinite(skorAkhir) || !rekomendasi) {
		throw error(400, 'onboardingId, skorAkhir, dan rekomendasi wajib diisi.');
	}

	try {
		await submitMentorEvaluation(karyawan.id, onboardingId, skorAkhir, rekomendasi, catatan);
		return json({ ok: true });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal menyimpan evaluasi.');
	}
};
