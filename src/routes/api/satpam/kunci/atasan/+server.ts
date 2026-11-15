import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { fetchKaryawanNames } from '$lib/server/keyService';

/**
 * Atasan peminjam (langsung + fungsional) — pilihan "izin atasan" saat meminjam kunci terbatas / bawa pulang.
 * Hanya mengembalikan id & nama (bukan nomor HP). Daftar kosong = peminjam belum punya atasan di data HR
 * (satpam tetap bisa memakai alasan atau jalur darurat).
 */
export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);
	const id = Number(event.url.searchParams.get('karyawan_id'));
	if (!Number.isInteger(id) || id <= 0) throw error(400, 'karyawan_id tidak valid.');

	const res = await directusServerJson<{ data: Array<{ atasan_id: number | null; atasan_fungsional_id: number | null }> }>(
		`/items/karyawan?${new URLSearchParams({ 'filter[id][_eq]': String(id), fields: 'atasan_id,atasan_fungsional_id', limit: '1' }).toString()}`
	);
	const row = res?.data?.[0];
	if (!row) throw error(404, 'Karyawan tidak ditemukan.');

	const names = await fetchKaryawanNames([row.atasan_id, row.atasan_fungsional_id]);
	const atasan: Array<{ id: number; nama: string; jenis: 'langsung' | 'fungsional' }> = [];
	if (row.atasan_id && row.atasan_id !== id) atasan.push({ id: row.atasan_id, nama: names.get(row.atasan_id) ?? `#${row.atasan_id}`, jenis: 'langsung' });
	if (row.atasan_fungsional_id && row.atasan_fungsional_id !== id && row.atasan_fungsional_id !== row.atasan_id) {
		atasan.push({ id: row.atasan_fungsional_id, nama: names.get(row.atasan_fungsional_id) ?? `#${row.atasan_fungsional_id}`, jenis: 'fungsional' });
	}
	return json({ atasan });
};
