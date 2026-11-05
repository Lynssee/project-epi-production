// src/routes/api/kiosk-proyek/roster/+server.ts
// Daftar kru + status absen hari ini untuk perangkat kiosk yang sudah diaktifkan.
// Satu request per buka layar; hasil di-cache di server (kiosk_proyek.roster_cache_detik).
// Alasan penolakan dikirim sebagai kode (reason) agar layar kiosk bisa menampilkan petunjuk yang tepat.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getKioskProyekSettings } from '$lib/server/kioskProyekSettings';
import { getRoster, kioskProyekSecret, touchDevice, validateDevice } from '$lib/server/kioskProyekDevice';
import { KIOSK_PROYEK_COOKIE, normalizeKode, verifyDeviceCookie } from '$lib/server/kioskProyekToken';
import { CATATAN_MAKS_KARAKTER } from '$lib/utils/kioskCatatan';

type Reason = 'kiosk_mati' | 'belum_aktif' | 'perangkat_tidak_sah' | 'kode_beda';
const deny = (reason: Reason, status: number, extra: Record<string, unknown> = {}) =>
	json({ ok: false, reason, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } });

export const GET: RequestHandler = async (event) => {
	const settings = await getKioskProyekSettings();
	if (!settings['kiosk_proyek.aktif']) return deny('kiosk_mati', 403);

	const device = verifyDeviceCookie(event.cookies.get(KIOSK_PROYEK_COOKIE), kioskProyekSecret());
	if (!device) return deny('belum_aktif', 401);

	const row = await validateDevice(device.d, device.p);
	if (!row) {
		event.cookies.delete(KIOSK_PROYEK_COOKIE, { path: '/' }); // dicabut / kedaluwarsa → bersihkan
		return deny('perangkat_tidak_sah', 401);
	}

	const roster = await getRoster(device.p, settings['kiosk_proyek.roster_cache_detik']);

	const kode = normalizeKode(event.url.searchParams.get('kode'));
	if (kode && roster.project.kode && roster.project.kode !== kode) {
		return deny('kode_beda', 409, { project_name: roster.project.name });
	}

	touchDevice(device.d);

	// HP pribadi (Fase 3): hanya melihat dirinya sendiri — nama & status rekan tidak dibuka di HP orang.
	// Dibuat objek baru (roster di-cache bersama, tidak boleh dimutasi).
	const saya = row.jenis === 'pribadi' ? Number(row.manpower_id) : null;
	const tampil = saya
		? (() => {
				const kru = roster.kru.filter((k) => k.manpower_id === saya);
				const hadir = kru.filter((k) => k.hari_ini?.status === 'hadir' || k.hari_ini?.status === 'setengah_hari').length;
				return { ...roster, kru, ringkasan: { terdaftar: kru.length, hadir, belum: kru.filter((k) => !k.hari_ini).length } };
			})()
		: roster;

	return json(
		{
			ok: true,
			mode: saya ? 'pribadi' : 'bersama',
			saya,
			device: { id: row.id, label: row.label, kedaluwarsa_pada: row.kedaluwarsa_pada },
			// Hanya yang dibutuhkan layar kru (kompresi foto); aturan lain dipegang server.
			pengaturan: {
				foto_maks_kb: settings['kiosk_proyek.foto_maks_kb'],
				// null = fitur dimatikan admin → tombol Catatan Kerja tidak tampil di kiosk.
				catatan: settings['kiosk_proyek.catatan_aktif']
					? {
							progres: settings['kiosk_proyek.catatan_kategori_progres'],
							kendala: settings['kiosk_proyek.catatan_kategori_kendala'],
							maks_karakter: CATATAN_MAKS_KARAKTER
						}
					: null,
				// null = Pakai Barang dimatikan admin → tombol tidak tampil di kiosk.
				pemakaian: settings['kiosk_proyek.pemakaian_aktif'] ? { foto_wajib: settings['kiosk_proyek.pemakaian_foto_wajib'] } : null
			},
			roster: tampil
		},
		{ headers: { 'Cache-Control': 'no-store' } }
	);
};
