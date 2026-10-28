// Diskusi per modul (Fase 3.5) — tampil langsung, moderasi via lapor + hapus HRD (admin).
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listDiskusiForModule, postDiskusi } from '$lib/server/ess/training';

export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);
	const moduleId = Number(event.url.searchParams.get('moduleId'));
	if (!Number.isFinite(moduleId)) throw error(400, 'moduleId tidak valid.');

	const diskusi = await listDiskusiForModule(moduleId);
	return json({ diskusi });
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json();
	const moduleId = Number(body.moduleId);
	const pesan = String(body.pesan || '').trim();
	const parentId = body.parentId == null ? null : Number(body.parentId);
	if (!Number.isFinite(moduleId) || !pesan) throw error(400, 'moduleId dan pesan wajib diisi.');
	if (pesan.length > 2000) throw error(400, 'Pesan terlalu panjang (maks 2000 karakter).');

	await postDiskusi(karyawan.id, moduleId, pesan, Number.isFinite(parentId as number) ? parentId : null);
	const diskusi = await listDiskusiForModule(moduleId);
	return json({ diskusi });
};
