// Referensi cepat Buku Saku (profil 360° terverifikasi + bahaya material R&D). Hanya karyawan login; cache server 10 menit.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { loadReferensiSaku } from '$lib/server/ess/referensiSaku';

let cache: { at: number; value: Awaited<ReturnType<typeof loadReferensiSaku>> } | null = null;
const TTL_MS = 600_000;

export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);
	if (!cache || Date.now() - cache.at > TTL_MS) cache = { at: Date.now(), value: await loadReferensiSaku() };
	return json(cache.value);
};
