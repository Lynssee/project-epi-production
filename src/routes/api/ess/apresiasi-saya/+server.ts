import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listApresiasiSaya, konfirmasiTerima } from '$lib/server/ess/apresiasi';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	return json({ data: await listApresiasiSaya(karyawan.id) });
};

// Konfirmasi terima + foto (multipart: distribusi_id, foto). Identitas dari token, bukan body.
export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const form = await event.request.formData().catch(() => null);
	if (!form) throw error(400, 'Form tidak valid');
	const foto = form.get('foto');
	await konfirmasiTerima(karyawan.id, Number(form.get('distribusi_id')), foto instanceof File ? foto : null);
	return json({ ok: true });
};
