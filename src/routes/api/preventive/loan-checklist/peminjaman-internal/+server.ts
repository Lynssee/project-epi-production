// src/routes/api/preventive/loan-checklist/peminjaman-internal/+server.ts
// Fase 3 (port BR-01 -> peminjaman_internal, 15 Sep 2026) — daftar peminjaman equipment
// aktif milik karyawan yang login. Server-side karena role Directus lapangan tidak
// diberi akses baca langsung ke peminjaman_internal (pola sama dgn /api/sji/*).
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { fetchMyActivePeminjamanInternal } from '$lib/server/preventive/loanGuard';

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawanByEmail(user.email);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	const loans = await fetchMyActivePeminjamanInternal(karyawan.id);
	return json({ data: loans });
};
