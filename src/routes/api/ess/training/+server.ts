import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listCatalogForKaryawan, listMyEnrollments } from '$lib/server/ess/training';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const [programs, enrollments] = await Promise.all([
		listCatalogForKaryawan(karyawan.divisi, karyawan.divisi_id),
		listMyEnrollments(karyawan.id)
	]);

	const byProgram = new Map(enrollments.map((e) => [e.program_id, e]));

	const kursus = programs.map((p) => {
		const enrollment = byProgram.get(p.id) || null;
		return {
			program: p,
			enrollment,
			terdaftar: !!enrollment,
			bisaSelfEnroll: !p.wajib && p.self_enroll && !enrollment
		};
	});

	return json({ kursus });
};
