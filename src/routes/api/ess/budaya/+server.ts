import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getBudaya } from '$lib/server/ess/budaya';

// Budaya EPI (Visi, Misi, Motto, Nilai Inti) — hanya untuk karyawan yang sudah login.
export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);
	const budaya = await getBudaya();
	return json(budaya, { headers: { 'Cache-Control': 'private, max-age=60' } });
};
