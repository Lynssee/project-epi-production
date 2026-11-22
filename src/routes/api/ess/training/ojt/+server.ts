import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listOjtTargets, getOjtForm, saveOjtForm, OjtError } from '$lib/server/ess/ojtField';

// GET                 -> daftar pelatihan bawahan yang bisa dinilai OJT.
// GET ?enrollmentId=N -> form penilaian satu peserta.
// POST                -> simpan draft / finalkan. Otorisasi tim diperiksa di server.
function fail(e: unknown, tag: string): never {
	if (e instanceof OjtError) throw error(e.status, e.message);
	console.error(`[ess/training/ojt] ${tag} gagal:`, (e as Error)?.message);
	throw error(500, 'Gagal memproses penilaian OJT.');
}

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const raw = event.url.searchParams.get('enrollmentId');
	try {
		if (raw) {
			const id = Number(raw);
			if (!Number.isInteger(id) || id <= 0) throw new OjtError('enrollmentId tidak valid', 400);
			return json(await getOjtForm(karyawan as any, id));
		}
		return json({ targets: await listOjtTargets(karyawan as any) });
	} catch (e) {
		fail(e, 'GET');
	}
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json().catch(() => ({}));
	const id = Number(body?.enrollmentId);
	if (!Number.isInteger(id) || id <= 0) throw error(400, 'enrollmentId tidak valid');
	try {
		return json(
			await saveOjtForm(karyawan as any, id, {
				items: body?.items,
				kekuatan: body?.kekuatan,
				kekurangan: body?.kekurangan,
				tindakLanjut: body?.tindakLanjut,
				finalize: body?.finalize === true
			})
		);
	} catch (e) {
		fail(e, 'POST');
	}
};
