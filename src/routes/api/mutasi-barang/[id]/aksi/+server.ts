// src/routes/api/mutasi-barang/[id]/aksi/+server.ts
// RSM-13 — aksi e-SJ Mutasi dari lapangan: setujui | tolak | kirim | terima | batal. (lolos_gerbang hanya di layar satpam.)
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { karyawanDariEvent, panggilMutasiErp } from '$lib/server/mutasiBridge';

const AKSI = ['setujui', 'tolak', 'kirim', 'terima', 'batal'];

export const POST: RequestHandler = async (event) => {
	const karyawan = await karyawanDariEvent(event);
	const id = Number(event.params.id);
	if (!Number.isInteger(id) || id <= 0) throw error(400, 'ID mutasi tidak valid');
	const body = await event.request.json().catch(() => ({}));
	if (!AKSI.includes(body?.aksi)) throw error(400, 'Aksi tidak dikenal');
	return json(await panggilMutasiErp(karyawan.id, 'aksi', { id, aksi: body.aksi, body }));
};
