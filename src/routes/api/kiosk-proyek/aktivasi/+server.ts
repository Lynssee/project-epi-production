// src/routes/api/kiosk-proyek/aktivasi/+server.ts
// Perangkat kiosk menukar token QR (dari HP leader) dengan cookie perangkat. TANPA Firebase —
// keabsahan dijamin tanda tangan HMAC token (umur pendek, sekali pakai) + kode proyek.
// hooks.server.ts tidak memblokir rute ini (tidak ada guard auth global di sana); pembatasan
// laju dipasang di sini karena endpoint ini publik.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRateLimited } from '$lib/server/rateLimit';
import { getKioskProyekSettings } from '$lib/server/kioskProyekSettings';
import { createDevice, kioskProyekSecret, resolveProjectByKode } from '$lib/server/kioskProyekDevice';
import {
	KIOSK_PROYEK_COOKIE,
	createUsedJtiStore,
	normalizeKode,
	signDeviceCookie,
	verifyActivationToken
} from '$lib/server/kioskProyekToken';
import { directusServerJson } from '$lib/server/directus';

const usedJti = createUsedJtiStore();

export const POST: RequestHandler = async (event) => {
	if (isRateLimited(`kp-aktivasi-ip:${event.getClientAddress()}`, { windowMs: 5 * 60 * 1000, max: 10 })) {
		throw error(429, 'Terlalu banyak percobaan aktivasi. Tunggu beberapa menit.');
	}

	const settings = await getKioskProyekSettings();
	if (!settings['kiosk_proyek.aktif']) {
		throw error(403, 'Kiosk Proyek belum diaktifkan oleh admin.');
	}

	let body: any;
	try {
		body = await event.request.json();
	} catch {
		throw error(400, 'Body harus JSON.');
	}
	const kode = normalizeKode(body?.kode);
	if (!kode) throw error(400, 'Kode kiosk tidak valid.');

	const secret = kioskProyekSecret();
	const act = verifyActivationToken(body?.token, secret);
	if (!act) throw error(401, 'QR aktivasi tidak valid atau sudah kedaluwarsa. Minta leader menampilkan QR baru.');

	const project = await resolveProjectByKode(kode);
	if (!project || project.id !== act.p) throw error(401, 'QR ini bukan untuk proyek tersebut. Minta leader menampilkan QR baru.');

	if (!usedJti.consume(act.j, act.exp)) {
		throw error(409, 'QR ini sudah dipakai. Minta leader menampilkan QR baru.');
	}

	const leaderNama = await directusServerJson<{ data: { nama?: string } }>(`/items/manpower/${act.l}?fields=id,nama`)
		.then((r) => r?.data?.nama || `manpower #${act.l}`)
		.catch((e) => {
			console.warn('[kiosk-proyek/aktivasi] gagal ambil nama leader (diabaikan):', e?.message);
			return `manpower #${act.l}`;
		});

	const label = typeof body?.label === 'string' && body.label.trim() ? body.label.trim() : 'Perangkat kiosk';
	const ttlDays = settings['kiosk_proyek.perangkat_masa_berlaku_hari'];
	const { id } = await createDevice({ projectId: project.id, label, leaderManpowerId: act.l, leaderNama, ttlDays });

	const cookie = signDeviceCookie({ deviceId: id, projectId: project.id, ttlDays }, secret);
	event.cookies.set(KIOSK_PROYEK_COOKIE, cookie.value, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: event.url.protocol === 'https:',
		maxAge: ttlDays * 86_400
	});

	return json({ ok: true, project: { id: project.id, name: project.name }, kedaluwarsa_pada: new Date(cookie.exp).toISOString() });
};
