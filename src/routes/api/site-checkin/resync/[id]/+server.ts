// src/routes/api/site-checkin/resync/[id]/+server.ts
// SV-06 (correction plan site-visit-payroll, Fase 2) — ACC HRD atas usulan tier sebelumnya
// TIDAK berdampak ke payroll: PATCH site_checkin.area_status='diterapkan' terjadi SETELAH
// check-out, jadi syncAbsensiLokasi() (yang hanya jalan SEKALI, saat check-out) sudah lewat.
// Endpoint ini memanggil ULANG syncAbsensiLokasi untuk kunjungan yang baru di-ACC, dipicu
// manual oleh HRD dari erp-epi-1 (lihat HrdSiteAreaVerifikasi.svelte) — BUKAN cron, jadi
// otorisasi via Firebase ID token + permission 'admin_panel' (pola sama ess/face/enroll).

import { error, json, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getUserPermissions, hasAnyPermission } from '$lib/server/rbacServer';
import { directusServerJson } from '$lib/server/directus';
import { syncAbsensiLokasi, type SiteCheckinRecord } from '$lib/server/siteCheckin';
import { todayJakarta } from '$lib/server/ess/time';

export async function POST(event: RequestEvent) {
	const user = await requireUser(event);
	const authHeader = event.request.headers.get('authorization') || '';
	const idToken = authHeader.replace(/^Bearer\s+/i, '');
	const { permissions } = await getUserPermissions(idToken, user.localId);
	if (!hasAnyPermission(permissions, 'admin_panel')) {
		throw error(403, 'Hanya HRD/Admin yang boleh menyinkronkan ulang kunjungan.');
	}

	const checkinId = event.params.id;
	if (!checkinId) throw error(400, 'ID kunjungan wajib diisi.');

	// Paket 04 §3.3 — HRD boleh memaksa lewati gate akurasi GPS (keputusan manusia: sudah
	// memeriksa foto/konteks kunjungan dan yakin karyawan memang hadir).
	const body = await event.request.json().catch(() => ({}));
	const paksa = body?.paksa === true;

	const query = new URLSearchParams({ fields: 'id,karyawan_id,tier_absensi,area_status,akurasi_in_m,check_in_at,status' });
	const result = await directusServerJson<{ data: SiteCheckinRecord }>(`/items/site_checkin/${checkinId}?${query.toString()}`).catch(() => null);
	const checkin = result?.data;
	if (!checkin) throw error(404, 'Kunjungan tidak ditemukan.');
	if (checkin.status !== 'completed') {
		throw error(409, `Kunjungan berstatus '${checkin.status}' — hanya kunjungan selesai (completed) yang bisa disinkronkan.`);
	}

	// SV-02: tanggal WAJIB dari check_in_at (WIB), sama seperti closeCheckin — bukan "hari ini".
	const tanggalCheckin = todayJakarta(new Date(checkin.check_in_at));
	const sync = await syncAbsensiLokasi(
		{
			karyawan_id: checkin.karyawan_id,
			tier_absensi: checkin.tier_absensi,
			area_status: checkin.area_status,
			akurasi_in_m: checkin.akurasi_in_m
		},
		tanggalCheckin,
		{ paksa }
	);

	await directusServerJson(`/items/site_checkin/${checkinId}`, {
		method: 'PATCH',
		body: JSON.stringify({
			absensi_sinkron: sync.synced,
			absensi_harian_id: sync.absensiHarianId,
			absensi_anomali: sync.anomali
		})
	});

	return json(sync);
}
