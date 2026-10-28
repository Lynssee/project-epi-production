// src/routes/api/site-checkin/auto-close/+server.ts
// POST: tutup semua site_checkin yang masih 'active' dari SEBELUM hari ini (lupa check-out).
// Dipanggil cron 00:05 (n8n -> erp-epi-1 /api/automation/site-checkin-auto-close -> sini).
// Otorisasi via shared secret di body — pola sama dengan automation endpoint erp-epi-1
// (sji-overdue-check, notif-summary, dst), memakai AUTOMATION_SERVER_SECRET yang sama.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { directusServerJson } from '$lib/server/directus';
import { closeCheckin } from '$lib/server/siteCheckin';
import { todayJakarta } from '$lib/server/ess/time';

export const POST: RequestHandler = async ({ request }) => {
	const expected = env.AUTOMATION_SERVER_SECRET;
	if (!expected) throw error(503, 'AUTOMATION_SERVER_SECRET belum dikonfigurasi di server.');

	const body = await request.json().catch(() => ({}));
	if (body?.secret !== expected) throw error(401, 'Invalid automation server secret');

	// check_in_at disimpan UTC, tapi "hari ini" karyawan itu kalender WIB (UTC+7) — bug ditemukan
	// saat review: batas naif `${today}T00:00:00` dibaca UTC, jadi selisih 7 jam dari midnight WIB
	// sebenarnya. Kalau cron ini pernah telat jalan (bukan tepat 00:05 WIB), rentang itu bisa
	// menutup paksa check-in yang masih sah aktif hari ini (00:00-06:59 WIB), bukan cuma yang lupa
	// checkout dari kemarin.
	const today = todayJakarta();
	const [y, m, d] = today.split('-').map(Number);
	const boundaryUtc = new Date(Date.UTC(y, m - 1, d) - 7 * 3600 * 1000);
	const query = new URLSearchParams({
		'filter[status][_eq]': 'active',
		'filter[check_in_at][_lt]': boundaryUtc.toISOString(),
		fields: 'id,karyawan_id,check_in_at',
		limit: '-1'
	});
	const res = await directusServerJson<{ data: { id: string; karyawan_id: string; check_in_at: string }[] }>(`/items/site_checkin?${query.toString()}`);
	const stale = res?.data || [];

	let closed = 0;
	let failed = 0;
	for (const row of stale) {
		try {
			// SV-03: akhir hari WIB dari HARI CHECK-IN kunjungan itu sendiri (bukan hari cron
			// jalan) — closeCheckin() juga memotong ke max_durasi_jam, jadi hasilnya min(keduanya).
			const checkInAt = new Date(row.check_in_at);
			const tanggalCheckin = todayJakarta(checkInAt);
			const [yy, mm, dd] = tanggalCheckin.split('-').map(Number);
			const akhirHariWib = new Date(Date.UTC(yy, mm - 1, dd, 23, 59, 59, 999) - 7 * 3600 * 1000);

			await closeCheckin({
				checkinId: row.id,
				karyawanId: row.karyawan_id,
				method: 'auto_midnight',
				lat: null,
				lng: null,
				akurasi: null,
				foto: null,
				checkOutAtOverride: akhirHariWib.toISOString()
			});
			closed += 1;
		} catch (e) {
			failed += 1;
			console.error('[site-checkin/auto-close] gagal tutup', row.id, e instanceof Error ? e.message : e);
		}
	}

	return json({ checked: stale.length, closed, failed });
};
