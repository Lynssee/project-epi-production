// src/routes/api/process-guidance/training/+server.ts
// GET ?ids=13,14 -> status training SAYA untuk program yang ditautkan di Peta Alur (T5). Wajib login (authenticateEss).
//   Sukses -> { success, source:'directus', programs:[{id,kode,judul,terbit,self_enroll,status_saya,progress,tenggat}] }
//   Gagal  -> { success:true, source:'fallback', programs:[] } (UI diam: tautan training tetap tampil tanpa status; tidak ada galat layar)
// Hanya membaca; maks. 20 id; tidak mendaftarkan siapa pun.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { loadMyTrainingStatus, parseIds } from '$lib/server/processGuidanceTraining';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const ids = parseIds(event.url?.searchParams.get('ids'));
	if (ids.length === 0) return json({ success: true, source: 'directus', programs: [] });
	try {
		return json({ success: true, source: 'directus', programs: await loadMyTrainingStatus(karyawan.id, ids) });
	} catch (e) {
		console.warn('[process-guidance/training] gagal:', e instanceof Error ? e.message : e);
		return json({ success: true, source: 'fallback', programs: [], warning: 'Status training gagal dimuat dari server.' });
	}
};
