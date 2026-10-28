// src/lib/server/ess/attendanceGuard.ts
// Guard bersama untuk endpoint /api/ess/attendance/*: verifikasi Firebase token,
// lalu resolve ke record karyawan Directus. Dipakai supaya 3 route tidak duplikat logic.

import { error, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanForUser, type ServerKaryawan } from '$lib/server/ess/karyawan';

export async function authenticateEss(
	event: RequestEvent
): Promise<{ user: Awaited<ReturnType<typeof requireUser>>; karyawan: ServerKaryawan }> {
	const user = await requireUser(event);
	// PC3-18: berlapis firebase_uid → email → email_company (dulu hanya email_company)
	const karyawan = await resolveKaryawanForUser({ uid: (user as any).uid, email: user.email });
	if (!karyawan) {
		// Tampilkan email login supaya HR/atasan bisa menautkan tanpa menebak (lokasi proyek tak punya HRD).
		throw error(
			403,
			`Akun ${user.email || '(tanpa email)'} belum terhubung ke data karyawan. Kirim screenshot layar ini ke admin HR atau atasan Anda.`
		);
	}
	return { user, karyawan };
}
