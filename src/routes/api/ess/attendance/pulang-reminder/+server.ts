import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { findTodayRecord } from '$lib/server/ess/absensi';
import { directusServerJson } from '$lib/server/directus';
import { todayJakarta, nowTimeJakarta } from '$lib/server/ess/time';

// GET /api/ess/attendance/pulang-reminder
// Sistem Denda Prosedural Karyawan — Fase 4 (pencegahan). Sumber data untuk banner persisten
// "Belum absen pulang" di ESS. Read-only, murah (2 query), gagal diam-diam (banner pelengkap).
//
// perluIngat = sudah absen masuk hari ini (status hadir) DAN belum absen pulang DAN
//              sekarang (WIB) sudah lewat jam pulang normal. Bukan denda — hanya pengingat.

const HADIR_LIKE = new Set(['HADIR', 'TERLAMBAT', 'SHIFT SIANG', 'SHIFT MALAM', 'LEMBUR', 'TUGAS']);
const EMPTY = new Set(['', '-', '--', '00:00', '00:00:00']);
const isBlank = (v: unknown) => EMPTY.has(String(v ?? '').trim());

function toMin(hhmm: string | null | undefined): number | null {
	const m = String(hhmm ?? '').match(/^(\d{1,2}):(\d{2})/);
	return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const tanggal = todayJakarta();

	try {
		const record = await findTodayRecord(karyawan.id, tanggal);
		if (!record || isBlank(record.jam_masuk) || !isBlank(record.jam_keluar)) {
			return json({ perluIngat: false, tanggal });
		}
		if (!HADIR_LIKE.has(String(record.status ?? '').trim().toUpperCase())) {
			return json({ perluIngat: false, tanggal });
		}

		let jamPulangNormal = '17:00';
		const karyawanRow = await directusServerJson<{ data: { jadwal_kerja_id: string | null } }>(
			`/items/karyawan/${karyawan.id}?fields=jadwal_kerja_id`
		).catch(() => null);
		const jadwalId = karyawanRow?.data?.jadwal_kerja_id || null;
		if (jadwalId) {
			const jadwal = await directusServerJson<{ data: { jam_keluar_normal: string | null } }>(
				`/items/jadwal_kerja/${jadwalId}?fields=jam_keluar_normal`
			).catch(() => null);
			if (jadwal?.data?.jam_keluar_normal) jamPulangNormal = String(jadwal.data.jam_keluar_normal).slice(0, 5);
		}

		const nowMin = toMin(nowTimeJakarta()) ?? 0;
		const pulangMin = toMin(jamPulangNormal) ?? 17 * 60;
		const perluIngat = nowMin >= pulangMin;

		return json({
			perluIngat,
			tanggal,
			jamMasuk: record.jam_masuk,
			jamPulangNormal,
			menitLewat: perluIngat ? nowMin - pulangMin : 0
		});
	} catch {
		return json({ perluIngat: false, tanggal });
	}
};
