// Catatan bertimestamp per modul (Fase 2.4) — privat per karyawan.
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listMyNotesForModule, createNote } from '$lib/server/ess/training';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const moduleId = Number(event.url.searchParams.get('moduleId'));
	if (!Number.isFinite(moduleId)) throw error(400, 'moduleId tidak valid.');

	const notes = await listMyNotesForModule(karyawan.id, moduleId);
	return json({ notes });
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json();
	const moduleId = Number(body.moduleId);
	const catatan = String(body.catatan || '').trim();
	const detik = body.detik == null ? null : Number(body.detik);
	if (!Number.isFinite(moduleId) || !catatan) throw error(400, 'moduleId dan catatan wajib diisi.');

	const note = await createNote(karyawan.id, moduleId, Number.isFinite(detik as number) ? detik : null, catatan);
	return json({ note });
};
