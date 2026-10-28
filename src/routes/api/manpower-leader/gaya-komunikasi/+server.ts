// src/routes/api/manpower-leader/gaya-komunikasi/+server.ts
// Tip gaya komunikasi (DISC) untuk anggota regu. Di server karena hasil tes bersifat data pribadi:
//   - hanya pemegang kursi leader di proyek itu yang boleh melihat;
//   - hanya anggota aktif proyek itu, dan hanya HURUF profil + tip yang dikembalikan
//     (bukan skor mentah, bukan hasil Big Five).
// Anggota yang belum tertaut ke karyawan / belum tes DISC tidak muncul — lapangan menampilkan
// "belum ada data", tidak menebak.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateManpowerLeader } from '$lib/server/manpowerLeaderGuard';
import { directusServerJson } from '$lib/server/directus';
import { tipDisc } from '$lib/shared/gayaKomunikasi';

const idOf = (v: any) => (v && typeof v === 'object' ? v.id : v);

export const GET: RequestHandler = async (event) => {
	const projectId = Number(event.url.searchParams.get('project_id'));
	if (!Number.isFinite(projectId)) throw error(400, 'project_id wajib diisi.');
	await authenticateManpowerLeader(event, projectId);

	const assign = await directusServerJson<{ data: any[] }>(
		`/items/manpower_assignment?filter[project_id][_eq]=${projectId}&filter[status][_eq]=aktif&fields=manpower_id&limit=-1`
	);
	const mpIds = [...new Set((assign?.data || []).map((a) => Number(idOf(a.manpower_id))).filter(Boolean))];
	if (!mpIds.length) return json({ data: {} });

	const mps = await directusServerJson<{ data: any[] }>(
		`/items/manpower?filter[id][_in]=${mpIds.join(',')}&fields=id,karyawan_id&limit=-1`
	);
	const mpToKar: Record<number, number> = {};
	for (const m of mps?.data || []) {
		const k = Number(idOf(m.karyawan_id));
		if (k) mpToKar[m.id] = k;
	}
	const karIds = [...new Set(Object.values(mpToKar))];
	if (!karIds.length) return json({ data: {} });

	const hasil = await directusServerJson<{ data: any[] }>(
		`/items/karyawan_assessment_result?filter[jenis_asesmen][_eq]=disc&filter[karyawan_id][_in]=${karIds.join(',')}` +
			`&fields=karyawan_id,profil_utama,tanggal_tes&sort=-tanggal_tes&limit=-1`
	);
	const terbaru: Record<number, string> = {};
	for (const r of hasil?.data || []) if (!terbaru[r.karyawan_id]) terbaru[r.karyawan_id] = r.profil_utama;

	const out: Record<number, { profil: string; tip: string }> = {};
	for (const [mp, kar] of Object.entries(mpToKar)) {
		const profil = terbaru[kar];
		if (profil) out[Number(mp)] = { profil, tip: tipDisc(profil) };
	}
	return json({ data: out });
};
