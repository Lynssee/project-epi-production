// src/routes/api/satpam/sj-antrian/+server.ts
// SJH-10 §4.4 — antrian SJ di gerbang untuk aplikasi satpam (/satpam/gate), auth Firebase.
// Sumber data SAMA dengan kiosk (getGerbangAntrian), supaya dua layar tidak berbeda.

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getGerbangAntrian } from '$lib/server/sjGerbangAntrian';

export const GET: RequestHandler = async (event) => {
	await requireUser(event);
	const { siap, belumSiap } = await getGerbangAntrian();
	return json({ antrian: siap, count: siap.length, belum_siap: belumSiap, belum_siap_count: belumSiap.length, generated_at: new Date().toISOString() });
};
