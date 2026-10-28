// src/routes/api/ess/attendance/riwayat/+server.ts
// GET ?dari=YYYY-MM-DD&sampai=YYYY-MM-DD → riwayat absensi_harian milik sendiri.
// Default rentang = 30 hari terakhir s/d hari ini (WIB). Dipakai tab Riwayat +
// tombol Ekspor di /ess/absen.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listRiwayatAbsensi } from '$lib/server/ess/absensi';
import { todayJakarta } from '$lib/server/ess/time';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const sampai = event.url.searchParams.get('sampai') || todayJakarta();
	let dari = event.url.searchParams.get('dari') || '';
	if (!dari) {
		const d = new Date();
		d.setDate(d.getDate() - 30);
		dari = todayJakarta(d);
	}
	if (!DATE_RE.test(dari) || !DATE_RE.test(sampai)) {
		throw error(400, 'Parameter dari/sampai harus format YYYY-MM-DD.');
	}
	if (dari > sampai) throw error(400, 'Tanggal "dari" tidak boleh setelah "sampai".');

	const rows = await listRiwayatAbsensi(karyawan.id, { dari, sampai });

	return json({
		rows,
		periode: { dari, sampai },
		karyawan: { id: karyawan.id, nama: karyawan.nama_karyawan }
	});
};
