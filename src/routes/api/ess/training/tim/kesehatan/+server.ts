import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getTeamTrainingHealth } from '$lib/server/ess/teamTraining';
import { listPendingSignoffs } from '$lib/server/ess/mentorSignoff';

// Kesehatan training tim untuk atasan/mentor (Fase 4 mentor_kpi_training): estimasi dampak ke KPI + status tiap bawahan.
// Id atasan SELALU dari sesi (authenticateEss), bukan input klien. Mode 'off' -> { aktif:false } (UI menyembunyikan).
export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const health = await getTeamTrainingHealth(karyawan.id);
	if (!health.aktif || health.anggota.length === 0) return json(health);
	// Percobaan ulang kuis yang menunggu persetujuan atasan (G_TRN_MENTOR_SIGNOFF) — gagal baca = daftar kosong, Pantauan Tim tetap tampil.
	const pending = await listPendingSignoffs(health.anggota.map((a) => a.karyawanId));
	const anggota = health.anggota.map((a) => ({
		...a,
		perluPersetujuan: pending.filter((p) => p.karyawanId === a.karyawanId).map((p) => ({ enrollmentId: p.enrollmentId, quizId: p.quizId, quizJudul: p.quizJudul, percobaan: p.percobaan }))
	}));
	return json({ ...health, anggota });
};
