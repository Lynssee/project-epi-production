// src/routes/api/project-charter/notify-submitted/+server.ts
// PRJ-35 — submitCharter masih client-side (Directus SDK); endpoint tipis ini HANYA memicu relay notifikasi
// ke Admin Project & PM setelah charter berhasil berstatus 'submitted'. Secret hanya boleh dipegang server.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { directusServerJson } from '$lib/server/directus';
import { notifyProjectCharterSubmitted } from '$lib/server/charterNotify';

export const POST: RequestHandler = async (event) => {
	const fbUser = await requireUser(event);
	const karyawan = await getKaryawanByFirebaseUid(fbUser.localId);
	if (!karyawan) throw error(403, 'Akun Anda belum terhubung ke data karyawan.');

	const body = await event.request.json().catch(() => ({}));
	const charterId = Number(body?.charterId);
	if (!charterId) throw error(400, 'charterId wajib diisi.');

	// Verifikasi di server: hanya notifikasi bila charter benar-benar 'submitted' (cegah spam).
	const res = await directusServerJson<{ data: any }>(
		`/items/project_charters/${charterId}?fields=id,status,submitted_by,project_id,so_customer_id`
	).catch((e: any) => {
		console.warn('[project-charter/notify-submitted] gagal baca charter:', e?.message);
		return null;
	});
	const c = res?.data;
	if (!c || c.status !== 'submitted') return json({ sent: false, reason: 'not_submitted' });

	// Nama proyek: query terpisah per relasi (Aturan #2); kolom project_name TIDAK ada di project_charters.
	let name = body?.projectName ? String(body.projectName) : '';
	if (!name && c.project_id) {
		const p = await directusServerJson<{ data: any }>(`/items/projects/${c.project_id}?fields=name`).catch(() => null);
		name = p?.data?.name || '';
	}
	if (!name && c.so_customer_id) {
		const so = await directusServerJson<{ data: any }>(`/items/so_customer/${c.so_customer_id}?fields=nomor_so`).catch(() => null);
		name = so?.data?.nomor_so ? `SO ${so.data.nomor_so}` : '';
	}
	if (!name) name = `Charter #${charterId}`;
	await notifyProjectCharterSubmitted(charterId, name, c.submitted_by || (karyawan as any).nama_karyawan || '');
	return json({ sent: true });
};
