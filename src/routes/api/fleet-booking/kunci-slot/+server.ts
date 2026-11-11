import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { pilihKunciKendaraan, type KunciKendaraanRow } from '$lib/server/keyService';

/**
 * Slot kunci per kendaraan untuk tiket booking: "Ambil kunci di Slot B-03, Key Box Pos Satpam".
 * Hanya mengembalikan info lokasi/status (tanpa nama pemegang). Kendaraan tanpa kunci terdaftar → tidak ada entri,
 * dan UI tidak menampilkan apa pun (modul kunci dipakai bertahap).
 * GET ?vehicle_ids=1,2,3 (maks. 50)
 */
export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);

	const ids = [
		...new Set(
			(event.url.searchParams.get('vehicle_ids') || '')
				.split(',')
				.map((v) => Number(v.trim()))
				.filter((n) => Number.isInteger(n) && n > 0)
		)
	].slice(0, 50);
	if (ids.length === 0) throw error(400, 'vehicle_ids wajib diisi (angka dipisah koma).');

	const res = await directusServerJson<{ data: KunciKendaraanRow[] }>(
		`/items/key_master?${new URLSearchParams({
			'filter[kendaraan_id][_in]': ids.join(','),
			'filter[is_active][_neq]': 'false',
			fields: 'id,kode_kunci,nama_kunci,kendaraan_id,tipe_salinan,lokasi_kotak,nomor_hook,status',
			limit: '-1'
		}).toString()}`
	);

	const slots: Record<number, { kode: string; lokasi_kotak: string | null; nomor_hook: string | null; status: string }> = {};
	for (const id of ids) {
		const k = pilihKunciKendaraan(res?.data || [], id);
		if (k) slots[id] = { kode: k.kode_kunci, lokasi_kotak: k.lokasi_kotak ?? null, nomor_hook: k.nomor_hook ?? null, status: k.status };
	}
	return json({ slots });
};
