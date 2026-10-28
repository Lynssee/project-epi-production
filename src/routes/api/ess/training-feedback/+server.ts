// src/routes/api/ess/training-feedback/+server.ts
// "Training Feedback Loop" (implementation_plan_panduan hrd.md) -- survei efektivitas
// training ~2 bulan pasca selesai. Baris training_feedback dibuat oleh automation
// erp-epi-1 (api/automation/training-feedback-reminder), di sini karyawan cuma baca
// miliknya sendiri & isi jawaban.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const rows = (await directusServerJson(
		`/items/training_feedback?filter[karyawan_id][_eq]=${karyawan.id}&sort=-tanggal_kirim&limit=-1&fields=id,program_id,status,tanggal_kirim,tanggal_isi,penerapan_skor,manfaat_skor,hambatan,catatan`
	))?.data || [];

	const programIds = [...new Set(rows.map((r: any) => r.program_id).filter(Boolean))];
	let programMap: Record<number, string> = {};
	if (programIds.length > 0) {
		const filter = encodeURIComponent(JSON.stringify({ id: { _in: programIds } }));
		const programs = (await directusServerJson(`/items/training_program?filter=${filter}&fields=id,judul&limit=-1`))?.data || [];
		programMap = Object.fromEntries(programs.map((p: any) => [p.id, p.judul]));
	}

	const data = rows.map((r: any) => ({ ...r, program_judul: programMap[r.program_id] || `Program #${r.program_id}` }));
	return json({ data });
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json().catch(() => null);

	const id = Number(body?.id);
	const penerapanSkor = Number(body?.penerapan_skor);
	const manfaatSkor = Number(body?.manfaat_skor);
	const hambatan = typeof body?.hambatan === 'string' ? body.hambatan.trim() : '';
	const catatan = typeof body?.catatan === 'string' ? body.catatan.trim() : '';

	if (!Number.isFinite(id)) throw error(400, 'ID survei tidak valid.');
	if (![1, 2, 3, 4, 5].includes(penerapanSkor) || ![1, 2, 3, 4, 5].includes(manfaatSkor)) {
		throw error(400, 'Skor penerapan & manfaat wajib diisi (1-5).');
	}

	const existing = (await directusServerJson(`/items/training_feedback/${id}?fields=id,karyawan_id,status`))?.data;
	if (!existing || Number(existing.karyawan_id) !== Number(karyawan.id)) {
		throw error(403, 'Survei ini bukan milik Anda.');
	}
	if (existing.status === 'diisi') {
		throw error(400, 'Survei ini sudah diisi sebelumnya.');
	}

	const updated = await directusServerJson(`/items/training_feedback/${id}`, {
		method: 'PATCH',
		body: JSON.stringify({
			status: 'diisi',
			tanggal_isi: new Date().toISOString(),
			penerapan_skor: penerapanSkor,
			manfaat_skor: manfaatSkor,
			hambatan: hambatan || null,
			catatan: catatan || null
		})
	});

	return json({ data: updated?.data });
};
