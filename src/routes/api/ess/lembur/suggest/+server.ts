// src/routes/api/ess/lembur/suggest/+server.ts
// FITUR-2 (Smart Overtime Request) — sugesti jam lembur otomatis dari data absensi aktual hari
// ini, dibandingkan jam_keluar_normal jadwal kerja karyawan. Read-only, tidak menulis apapun.
// Karyawan tetap bisa mengedit manual di form; ini hanya prefill.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';

const BUFFER_MENIT = 15; // toleransi sebelum dianggap "checkout lebih dari jadwal"

function parseTimeToMinutes(str: string | null | undefined): number | null {
	if (!str || typeof str !== 'string') return null;
	const parts = str.split(':');
	if (parts.length < 2) return null;
	const h = Number(parts[0]);
	const m = Number(parts[1]);
	if (Number.isNaN(h) || Number.isNaN(m)) return null;
	return h * 60 + m;
}

function minutesToHHMM(total: number): string {
	const h = Math.floor(total / 60) % 24;
	const m = total % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const tanggal = todayJakarta();

	const karyawanRes = await directusServerJson<{ data: { jadwal_kerja_id: string | null } }>(
		`/items/karyawan/${karyawan.id}?fields=jadwal_kerja_id`
	);
	const jadwalId = karyawanRes?.data?.jadwal_kerja_id || null;
	if (!jadwalId) return json({ suggestion: null });

	const jadwalRes = await directusServerJson<{ data: { jam_keluar_normal: string | null } }>(
		`/items/jadwal_kerja/${jadwalId}?fields=jam_keluar_normal`
	);
	const jamKeluarNormal = parseTimeToMinutes(jadwalRes?.data?.jam_keluar_normal);
	if (jamKeluarNormal == null) return json({ suggestion: null });

	const absensiQuery = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawan.id),
		'filter[tanggal][_eq]': tanggal,
		fields: 'jam_keluar',
		limit: '1'
	});
	const absensiRes = await directusServerJson<{ data: Array<{ jam_keluar: string | null }> }>(
		`/items/absensi_harian?${absensiQuery.toString()}`
	);
	const jamKeluarAktual = parseTimeToMinutes(absensiRes?.data?.[0]?.jam_keluar);
	if (jamKeluarAktual == null) return json({ suggestion: null });

	if (jamKeluarAktual <= jamKeluarNormal + BUFFER_MENIT) return json({ suggestion: null });

	return json({
		suggestion: {
			tanggal,
			jamMulai: minutesToHHMM(jamKeluarNormal),
			jamSelesai: minutesToHHMM(jamKeluarAktual)
		}
	});
};
