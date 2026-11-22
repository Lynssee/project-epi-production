// Status kelulusan SAYA untuk beberapa program (dipakai Kartu 360° lapangan: "Anda sudah lulus" vs "Pelajari & Kuis 5 Menit").
// Hanya membaca enrollment milik karyawan login — 1 query, tanpa isi modul.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listMyEnrollments } from '$lib/server/ess/training';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const ids = new Set(
		(event.url.searchParams.get('ids') || '')
			.split(',')
			.map((s) => Number(s))
			.filter((n) => Number.isFinite(n) && n > 0)
			.slice(0, 50)
	);
	const enrollments = ids.size ? await listMyEnrollments(karyawan.id) : [];
	const status: Record<string, string> = {};
	for (const e of enrollments) if (ids.has(e.program_id)) status[String(e.program_id)] = e.status;
	return json({ status });
};
