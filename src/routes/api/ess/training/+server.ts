import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listCatalogForKaryawan, listMyEnrollments } from '$lib/server/ess/training';
import { getPillarConfig, pillarOfProgram } from '$lib/server/ess/trainingPillars';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const [programs, enrollments, pillarConfig] = await Promise.all([
		listCatalogForKaryawan(karyawan.divisi, karyawan.divisi_id),
		listMyEnrollments(karyawan.id),
		getPillarConfig()
	]);

	const byProgram = new Map(enrollments.map((e) => [e.program_id, e]));

	const kursus = programs.map((p) => {
		const enrollment = byProgram.get(p.id) || null;
		return {
			program: p,
			enrollment,
			terdaftar: !!enrollment,
			bisaSelfEnroll: !p.wajib && p.self_enroll && !enrollment,
			pilar: pillarOfProgram(p, pillarConfig)
		};
	});

	// Hanya pilar yang punya kursus untuk karyawan ini — chip kosong hanya membingungkan di HP.
	const jumlah = new Map<string, number>();
	for (const k of kursus) jumlah.set(k.pilar, (jumlah.get(k.pilar) ?? 0) + 1);
	const pilar = pillarConfig.pillars
		.filter((p) => (jumlah.get(p.code) ?? 0) > 0)
		.map(({ code, label, short, icon, hint }) => ({ code, label, short, icon, hint, jumlah: jumlah.get(code) ?? 0 }));

	return json({ kursus, pilar });
};
