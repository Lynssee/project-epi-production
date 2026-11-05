// src/lib/server/kioskProyekAuth.ts
// Autentikasi perangkat kiosk proyek untuk endpoint baru (Fase 5+): cookie HMAC → baris perangkat sah → setelan.
// Mengembalikan Response penolakan (bukan melempar) supaya layar kiosk bisa menampilkan petunjuk sesuai `reason`.
// Endpoint lama (roster/absen/catatan) memakai pola yang sama secara inline; tidak diubah agar tidak berisiko.

import { json, type RequestEvent } from '@sveltejs/kit';
import { getKioskProyekSettings, type KioskProyekSettings } from '$lib/server/kioskProyekSettings';
import { kioskProyekSecret, validateDevice, type PerangkatRow } from '$lib/server/kioskProyekDevice';
import { KIOSK_PROYEK_COOKIE, verifyDeviceCookie } from '$lib/server/kioskProyekToken';

export type HasilAuthPerangkat =
	| { ok: true; settings: KioskProyekSettings; deviceId: number; projectId: number; row: PerangkatRow }
	| { ok: false; response: Response };

const tolak = (reason: string, status: number): HasilAuthPerangkat => ({
	ok: false,
	response: json({ ok: false, reason }, { status, headers: { 'Cache-Control': 'no-store' } })
});

export async function authPerangkatKiosk(event: RequestEvent): Promise<HasilAuthPerangkat> {
	const settings = await getKioskProyekSettings();
	if (!settings['kiosk_proyek.aktif']) return tolak('kiosk_mati', 403);

	const device = verifyDeviceCookie(event.cookies.get(KIOSK_PROYEK_COOKIE), kioskProyekSecret());
	if (!device) return tolak('belum_aktif', 401);

	const row = await validateDevice(device.d, device.p);
	if (!row) {
		event.cookies.delete(KIOSK_PROYEK_COOKIE, { path: '/' });
		return tolak('perangkat_tidak_sah', 401);
	}
	return { ok: true, settings, deviceId: device.d, projectId: device.p, row };
}
