// src/routes/api/kiosk-proyek/ikat/+server.ts
// Ikat HP PRIBADI kru ke satu nama (Rencana Kiosk Proyek, Fase 3). Tanpa Firebase.
// Dua langkah supaya daftar nama tidak terbuka untuk siapa pun yang tahu kode proyek (poster/link):
//   1. {langkah:'kode', kode_harian}  → bila kode harian (6 digit) benar: token ikat 10 menit + daftar nama
//   2. {langkah:'pilih', bind_token, manpower_id} → perangkat jenis 'pribadi' dibuat + cookie terpasang
// Kode harian (6 digit) tampil di HP leader dan berganti tiap hari (mode 'nonaktif' = langkah 1 tanpa kode).
// Satu orang = satu HP pribadi aktif per proyek: ikat baru otomatis mencabut yang lama.
// HP pribadi hanya bisa mengabsenkan diri sendiri (ditegakkan di /api/kiosk-proyek/absen).

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRateLimited } from '$lib/server/rateLimit';
import { catatGagal, terkunci } from '$lib/server/kioskProyekLimit';
import { getKioskProyekSettings } from '$lib/server/kioskProyekSettings';
import {
	cabutPribadiLama,
	createDevice,
	getRoster,
	kioskProyekSecret,
	listPribadiAktif,
	resolveProjectByKode
} from '$lib/server/kioskProyekDevice';
import {
	KIOSK_PROYEK_COOKIE,
	cocokKodeHarian,
	normalizeKode,
	signBindToken,
	signDeviceCookie,
	todayWIB,
	verifyBindToken
} from '$lib/server/kioskProyekToken';

const BIND_TTL_DETIK = 600;

const noStore = { headers: { 'Cache-Control': 'no-store' } };

async function bukaProyek(kodeRaw: unknown) {
	const settings = await getKioskProyekSettings();
	if (!settings['kiosk_proyek.aktif']) throw error(403, 'Kiosk Proyek belum diaktifkan oleh admin.');
	const kode = normalizeKode(kodeRaw);
	if (!kode) throw error(400, 'Kode kiosk tidak valid.');
	const project = await resolveProjectByKode(kode);
	if (!project) throw error(404, 'Kode kiosk tidak dikenal.');
	return { settings, project };
}

export const GET: RequestHandler = async (event) => {
	const { settings, project } = await bukaProyek(event.url.searchParams.get('kode'));
	return json(
		{ ok: true, project_name: project.name, butuh_kode_harian: settings['kiosk_proyek.kode_harian_mode'] === 'harian' },
		noStore
	);
};

export const POST: RequestHandler = async (event) => {
	if (isRateLimited(`kp-ikat-ip:${event.getClientAddress()}`, { windowMs: 5 * 60 * 1000, max: 12 })) {
		throw error(429, 'Terlalu banyak percobaan. Tunggu beberapa menit.');
	}
	let body: any;
	try {
		body = await event.request.json();
	} catch {
		throw error(400, 'Body harus JSON.');
	}
	const { settings, project } = await bukaProyek(body?.kode);
	// Batas per proyek: menahan tebak-tebak kode dari banyak IP (hanya kegagalan yang dihitung).
	if (body?.langkah === 'kode' && terkunci(project.id)) {
		throw error(429, 'Terlalu banyak kode salah untuk proyek ini. Tunggu 15 menit, atau minta leader mengaktifkan HP lewat QR.');
	}
	const secret = kioskProyekSecret();
	const rosterTtl = settings['kiosk_proyek.roster_cache_detik'];

	if (body?.langkah === 'kode') {
		if (settings['kiosk_proyek.kode_harian_mode'] === 'harian' && !cocokKodeHarian(body?.kode_harian, project.id, todayWIB(), secret)) {
			catatGagal(project.id);
			throw error(401, 'Kode harian salah. Lihat kode 6 digit di HP leader (tab Kiosk) dan coba lagi.');
		}
		const [roster, terikat] = await Promise.all([getRoster(project.id, rosterTtl), listPribadiAktif(project.id)]);
		const sudah = new Set(terikat.map((d) => d.manpower_id));
		const { token } = signBindToken({ projectId: project.id, ttlSeconds: BIND_TTL_DETIK }, secret);
		return json(
			{
				ok: true,
				bind_token: token,
				project_name: project.name,
				kru: roster.kru.map((k) => ({ manpower_id: k.manpower_id, nama: k.nama, posisi: k.posisi, terikat: sudah.has(k.manpower_id) }))
			},
			noStore
		);
	}

	if (body?.langkah === 'pilih') {
		const bt = verifyBindToken(body?.bind_token, secret);
		if (!bt || bt.p !== project.id) throw error(401, 'Sesi ikat HP habis. Masukkan kode harian lagi.');
		const manpowerId = Number(body?.manpower_id);
		if (!Number.isInteger(manpowerId) || manpowerId <= 0) throw error(400, 'Pilih nama Anda.');

		const roster = await getRoster(project.id, rosterTtl);
		const kru = roster.kru.find((k) => k.manpower_id === manpowerId);
		if (!kru) throw error(403, 'Nama ini tidak terdaftar di proyek ini.');

		const diganti = await cabutPribadiLama(project.id, manpowerId, 'diganti ikat HP baru');
		const ttlDays = settings['kiosk_proyek.perangkat_masa_berlaku_hari'];
		const { id } = await createDevice({
			projectId: project.id,
			label: `HP ${kru.nama}`,
			leaderManpowerId: manpowerId,
			leaderNama: `Ikat sendiri: ${kru.nama}`,
			ttlDays,
			jenis: 'pribadi',
			manpowerId
		});
		const cookie = signDeviceCookie({ deviceId: id, projectId: project.id, ttlDays }, secret);
		event.cookies.set(KIOSK_PROYEK_COOKIE, cookie.value, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: event.url.protocol === 'https:',
			maxAge: ttlDays * 86_400
		});
		return json({ ok: true, nama: kru.nama, hp_lama_dicabut: diganti, kedaluwarsa_pada: new Date(cookie.exp).toISOString() }, noStore);
	}

	throw error(400, 'langkah harus "kode" atau "pilih".');
};
