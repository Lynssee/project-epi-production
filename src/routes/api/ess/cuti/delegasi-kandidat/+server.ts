// src/routes/api/ess/cuti/delegasi-kandidat/+server.ts
// Daftar rekan kerja (seluruh karyawan aktif) untuk dipilih sebagai penerima delegasi tugas
// saat mengajukan cuti/izin/sakit. Field di-whitelist eksplisit (id, nama_karyawan) — sama
// prinsipnya dengan /api/ess/direktori di erp-epi-1.
//
// SENGAJA tidak difilter per-divisi (berbeda dari assertCanApprove dkk di divisi.ts): ini
// cuma daftar "siapa yang menanggung tugas Anda", bukan otorisasi approval, dan label divisi
// karyawan masih banyak yang tidak konsisten/kosong (lihat catatan T7 di divisi.ts). Memfilter
// ketat _eq divisi bisa membuat dropdown ini kosong untuk karyawan yang divisinya tidak match
// persis siapa pun — padahal delegasi sekarang WAJIB diisi, jadi dropdown kosong = lockout total.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const filter = {
		_and: [
			{ status: { _neq: 'Off' } },
			{ status_kerja: { _nin: ['Tidak Aktif', 'Hanya akun'] } },
			{ id: { _neq: karyawan.id } }
		]
	};

	const query = new URLSearchParams({
		fields: 'id,nama_karyawan',
		filter: JSON.stringify(filter),
		sort: 'nama_karyawan',
		limit: '-1'
	});
	const res = await directusServerJson<{ data: { id: number; nama_karyawan: string }[] }>(
		`/items/karyawan?${query.toString()}`
	);
	return json({ employees: res?.data || [] });
};
