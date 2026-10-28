// src/routes/api/mutasi-barang/+server.ts
// RSM-13 — daftar & pengajuan e-SJ Mutasi untuk leader lapangan. Semua diputuskan mesin erp-epi (lihat mutasiBridge.ts).
import { json, type RequestHandler } from '@sveltejs/kit';
import { karyawanDariEvent, panggilMutasiErp } from '$lib/server/mutasiBridge';

export const GET: RequestHandler = async (event) => {
	const karyawan = await karyawanDariEvent(event);
	const projectId = Number(event.url.searchParams.get('project_id')) || null;
	const aktif = event.url.searchParams.get('aktif') !== '0';
	return json(await panggilMutasiErp(karyawan.id, 'daftar', { project_id: projectId, aktif }));
};

export const POST: RequestHandler = async (event) => {
	const karyawan = await karyawanDariEvent(event);
	const input = await event.request.json().catch(() => ({}));
	return json(await panggilMutasiErp(karyawan.id, 'ajukan', { input }));
};
