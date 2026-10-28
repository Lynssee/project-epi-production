// src/routes/api/site-checkin/+server.ts
// POST: buat check-in baru (multipart/form-data: referensi_id, lat, lng, accuracy, foto, catatan?)
// GET: daftar check-in milik karyawan yang login, hari ini (WIB)

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { createCheckin, AkurasiGpsError, TipeMaintenanceNonaktifError } from '$lib/server/siteCheckin';
import { todayJakarta } from '$lib/server/ess/time';

async function hashString(s: string): Promise<string> {
	const buf = new TextEncoder().encode(s);
	const digest = await crypto.subtle.digest('SHA-256', buf);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const form = await event.request.formData();
	const referensiIdRaw = form.get('referensi_id')?.toString() || '';
	const lat = Number(form.get('lat'));
	const lng = Number(form.get('lng'));
	const akurasi = form.get('accuracy') != null ? Number(form.get('accuracy')) : null;
	const foto = form.get('foto');
	const catatan = form.get('catatan')?.toString() || undefined;
	const bookingId = form.get('booking_id')?.toString() || null;
	// "4-Gate Site Visit System" Fase 3 — default 'proyek' bila klien belum kirim (lama).
	// Paket 08a Site Visit Release (Opsi 1, Lead 29 Sep 2026) — 'marketing' TIDAK LAGI diterima
	// dari sini: kunjungan customer/prospek sekarang lewat /sales/baru (endpoint terpisah, 08b).
	// Ditolak eksplisit (bukan diam-diam dialihkan) supaya aplikasi versi lama yang masih
	// mengirim tipe ini terlihat, bukan gagal-lunak tanpa penjelasan.
	const tipeKeperluanRaw = form.get('tipe_keperluan')?.toString();
	if (tipeKeperluanRaw === 'marketing') {
		throw error(422, 'Kunjungan ke customer/prospek sekarang dicatat di menu Sales → Kunjungan Baru.');
	}
	const tipeKeperluan = tipeKeperluanRaw === 'maintenance' ? 'maintenance' : 'proyek';
	// maintenance: referensi_id adalah UUID work_order.id (string) — proyek tetap numerik.
	const referensiId: number | string = tipeKeperluan === 'maintenance' ? referensiIdRaw : Number(referensiIdRaw);

	// Penajaman SDM v2 Fase 5: fingerprint dari header request (belum ada penyimpanan device ID
	// sisi klien) — cukup untuk beda HP/browser yang jelas berbeda, bukan device ID sempurna.
	// network_type opsional dari klien (navigator.connection bila tersedia); null bila tak dikirim.
	const uaFingerprintSrc = `${event.request.headers.get('user-agent') || ''}|${event.request.headers.get('accept-language') || ''}`;
	const deviceFingerprint = await hashString(uaFingerprintSrc);
	const networkTypeRaw = form.get('network_type')?.toString();
	const networkType = networkTypeRaw === 'wifi' || networkTypeRaw === 'cellular' || networkTypeRaw === 'offline' ? networkTypeRaw : null;
	// SV-12: waktu check-in sebenarnya di HP, dikirim saat replay dari antrean offline.
	const clientCreatedAt = form.get('client_created_at')?.toString() || null;
	// SV-12 (skema disetujui Lead 26 Sep 2026): UUID dedup exact-match, dibuat klien saat masuk antrean offline.
	const clientTxnId = form.get('client_txn_id')?.toString() || null;

	const referensiIdValid = tipeKeperluan === 'maintenance' ? referensiId !== '' : Number.isFinite(referensiId) && (referensiId as number) > 0;
	if (!referensiIdValid) {
		throw error(400, tipeKeperluan === 'maintenance' ? 'Work Order tujuan check-in wajib dipilih.' : 'Proyek tujuan check-in wajib dipilih.');
	}
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
		throw error(400, 'Lokasi GPS tidak valid. Aktifkan izin lokasi dan coba lagi.');
	}
	if (!(foto instanceof File) || foto.size === 0) {
		throw error(400, 'Foto wajib diambil saat check-in.');
	}

	try {
		const record = await createCheckin({
			karyawanId: String(karyawan.id),
			referensiId,
			lat,
			lng,
			akurasi,
			foto,
			catatan,
			bookingId,
			deviceFingerprint,
			networkType,
			tipeKeperluan,
			clientCreatedAt,
			clientTxnId
		});
		return json({ record });
	} catch (e) {
		if (e instanceof AkurasiGpsError) throw error(422, e.message);
		if (e instanceof TipeMaintenanceNonaktifError) throw error(422, e.message);
		throw error(400, e instanceof Error ? e.message : 'Gagal membuat check-in');
	}
};

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	// check_in_at disimpan UTC (new Date().toISOString() di createCheckin), tapi "hari ini" bagi
	// karyawan adalah kalender WIB (UTC+7) — bug ditemukan saat review: batas T00:00:00/T23:59:59
	// tanpa offset sebelumnya dibaca sebagai UTC, jadi check-in WIB 00:00-06:59 (UTC hari sebelumnya)
	// hilang dari daftar "hari ini", dan check-in UTC 17:00-23:59 (=WIB dini hari besok) malah ikut.
	const tanggal = todayJakarta();
	const [y, m, d] = tanggal.split('-').map(Number);
	const startUtc = new Date(Date.UTC(y, m - 1, d) - 7 * 3600 * 1000);
	const endUtc = new Date(startUtc.getTime() + 24 * 3600 * 1000 - 1);
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawan.id),
		'filter[check_in_at][_gte]': startUtc.toISOString(),
		'filter[check_in_at][_lte]': endUtc.toISOString(),
		sort: '-check_in_at',
		limit: '-1'
	});
	const result = await directusServerJson<{ data: any[] }>(`/items/site_checkin?${query.toString()}`);
	return json({ records: result?.data || [] });
};
