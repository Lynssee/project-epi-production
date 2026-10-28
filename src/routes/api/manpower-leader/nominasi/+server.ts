// src/routes/api/manpower-leader/nominasi/+server.ts
// Nominasi calon leader regu oleh Manpower Leader. Di server (bukan klien) supaya:
//   - hanya pemegang kursi leader di proyek itu yang bisa menominasikan;
//   - nominee wajib anggota aktif proyek yang sama, bukan diri sendiri;
//   - status selalu 'pending' — persetujuan hanya lewat admin (erp-epi), tidak bisa dilewati klien.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateManpowerLeader } from '$lib/server/manpowerLeaderGuard';
import { directusServerJson } from '$lib/server/directus';
import { validasiNominasi } from '$lib/shared/leaderNominasi';

export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => null);
	const projectId = Number(body?.project_id);
	const nomineeId = Number(body?.nominee_manpower_id);
	if (!Number.isFinite(projectId) || !Number.isFinite(nomineeId)) {
		throw error(400, 'project_id dan nominee_manpower_id wajib diisi.');
	}
	const salah = validasiNominasi({ rating: body?.rating, tags: body?.tags, catatan: body?.catatan });
	if (salah) throw error(400, salah);

	const { manpower } = await authenticateManpowerLeader(event, projectId);
	if (Number(manpower.id) === nomineeId) throw error(400, 'Tidak bisa menominasikan diri sendiri.');

	const assign = await directusServerJson<{ data: any[] }>(
		`/items/manpower_assignment?filter[project_id][_eq]=${projectId}&filter[manpower_id][_eq]=${nomineeId}` +
			`&filter[status][_eq]=aktif&fields=id&limit=1`
	);
	if (!assign?.data?.length) throw error(400, 'Orang ini bukan anggota aktif regu di proyek ini.');

	// satu nominasi menunggu per (nominator, nominee) — cegah spam, bukan melarang nominasi ulang setelah diputuskan
	const dup = await directusServerJson<{ data: any[] }>(
		`/items/leader_nomination?filter[nominator_manpower_id][_eq]=${manpower.id}` +
			`&filter[nominee_manpower_id][_eq]=${nomineeId}&filter[status][_eq]=pending&fields=id&limit=1`
	);
	if (dup?.data?.length) throw error(409, 'Nominasi untuk orang ini masih menunggu review HRD.');

	const nominee = await directusServerJson<{ data: any }>(`/items/manpower/${nomineeId}?fields=id,karyawan_id`).then((r) => r?.data);
	const karyawanId = nominee?.karyawan_id && typeof nominee.karyawan_id === 'object' ? nominee.karyawan_id.id : nominee?.karyawan_id;

	await directusServerJson('/items/leader_nomination', {
		method: 'POST',
		body: JSON.stringify({
			nominee_manpower_id: nomineeId,
			nominee_karyawan_id: karyawanId ? Number(karyawanId) : null,
			project_id: projectId,
			nominator_manpower_id: manpower.id,
			tags: body.tags,
			rating: Number(body.rating),
			catatan: String(body.catatan ?? '').trim() || null,
			status: 'pending'
		})
	});

	return json({ success: true });
};
