// Status onboarding karyawan berjalan (Fase 1.2) — sumber data banner soft-gate di beranda ESS.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listOnboardingPrograms, listMyEnrollmentsForPrograms } from '$lib/server/ess/training';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const programs = await listOnboardingPrograms();
	const enrollmentMap = await listMyEnrollmentsForPrograms(
		karyawan.id,
		programs.map((p) => p.id)
	);

	const programList = programs.map((program) => ({
		program,
		enrollment: enrollmentMap.get(program.id) ?? null
	}));
	const belumLulus = programList.filter(({ enrollment }) => enrollment?.status !== 'Lulus');
	const tenggatTerdekat = belumLulus
		.map(({ enrollment }) => enrollment?.tenggat)
		.filter((t): t is string => !!t)
		.sort()[0] ?? null;

	return json({
		selesai: belumLulus.length === 0 && programList.length > 0,
		totalProgram: programList.length,
		totalSelesai: programList.length - belumLulus.length,
		tenggatTerdekat,
		programBerikutnya: belumLulus[0]?.program ?? null
	});
};
