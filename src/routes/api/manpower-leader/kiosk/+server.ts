// src/routes/api/manpower-leader/kiosk/+server.ts
// Sisi LEADER untuk Kiosk Proyek (Rencana Kiosk Proyek, Fase 1): lihat kode & perangkat,
// tampilkan QR aktivasi, cabut perangkat. Auth Firebase + wajib pegang kursi di proyek
// (authenticateManpowerLeader) — sama dengan absen-regu.
//
//   GET  ?project_id=N                       → kode kiosk, setelan ringkas, daftar perangkat
//   POST {project_id, action:'token'}        → token aktivasi berumur pendek (untuk QR)
//   POST {project_id, action:'cabut', id}    → cabut perangkat

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateManpowerLeader } from '$lib/server/manpowerLeaderGuard';
import { getKioskProyekSettings } from '$lib/server/kioskProyekSettings';
import { ensureKiosKode, kioskProyekSecret, listDevices, namaManpower, revokeDevice } from '$lib/server/kioskProyekDevice';
import { kodeHarian, signActivationToken, todayWIB } from '$lib/server/kioskProyekToken';

function parseProjectId(v: unknown): number {
	const n = Number(v);
	if (!Number.isInteger(n) || n <= 0) throw error(400, 'project_id tidak valid.');
	return n;
}

export const GET: RequestHandler = async (event) => {
	const projectId = parseProjectId(event.url.searchParams.get('project_id'));
	await authenticateManpowerLeader(event, projectId);

	const [settings, kode, perangkat] = await Promise.all([
		getKioskProyekSettings(),
		ensureKiosKode(projectId),
		listDevices(projectId)
	]);
	const now = Date.now();
	const nama = await namaManpower(perangkat.map((p) => Number(p.manpower_id)));
	const modeKode = settings['kiosk_proyek.kode_harian_mode'];
	return json({
		kode,
		// Kode 6 digit untuk kru yang mengikat HP pribadinya; berganti otomatis tiap hari (WIB). Hanya untuk leader.
		kode_harian_mode: modeKode,
		kode_harian: modeKode === 'harian' ? kodeHarian(projectId, todayWIB(), kioskProyekSecret()) : null,
		aktif: settings['kiosk_proyek.aktif'],
		qr_detik: settings['kiosk_proyek.aktivasi_qr_detik'],
		masa_berlaku_hari: settings['kiosk_proyek.perangkat_masa_berlaku_hari'],
		perangkat: perangkat.map((p) => ({
			...p,
			manpower_nama: p.manpower_id ? nama.get(Number(p.manpower_id)) ?? null : null,
			status: !p.aktif ? 'dicabut' : p.kedaluwarsa_pada && new Date(p.kedaluwarsa_pada).getTime() < now ? 'kedaluwarsa' : 'aktif'
		}))
	});
};

export const POST: RequestHandler = async (event) => {
	let body: any;
	try {
		body = await event.request.json();
	} catch {
		throw error(400, 'Body harus JSON.');
	}
	const projectId = parseProjectId(body?.project_id);
	const { manpower } = await authenticateManpowerLeader(event, projectId);

	if (body?.action === 'token') {
		const settings = await getKioskProyekSettings();
		if (!settings['kiosk_proyek.aktif']) {
			throw error(409, 'Kiosk Proyek belum diaktifkan admin (Pengaturan → Kiosk → Kiosk Proyek).');
		}
		const kode = await ensureKiosKode(projectId);
		const { token, exp } = signActivationToken(
			{ projectId, leaderManpowerId: manpower.id, ttlSeconds: settings['kiosk_proyek.aktivasi_qr_detik'] },
			kioskProyekSecret()
		);
		return json({ kode, token, exp });
	}

	if (body?.action === 'cabut') {
		const id = Number(body?.id);
		if (!Number.isInteger(id) || id <= 0) throw error(400, 'id perangkat tidak valid.');
		await revokeDevice(id, projectId, manpower.nama || `manpower #${manpower.id}`);
		return json({ ok: true });
	}

	throw error(400, 'action harus "token" atau "cabut".');
};
