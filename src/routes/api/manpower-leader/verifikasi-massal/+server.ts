// src/routes/api/manpower-leader/verifikasi-massal/+server.ts
// Setujui BANYAK absensi sekaligus untuk baris yang "normal" (Rencana Kiosk Proyek, Fase 2).
// Server menilai ulang tiap baris dengan absensiNormal() — klien hanya mengirim id, jadi baris anomali
// (di luar radius, penanda kiosk, dobel proyek, terkunci) TIDAK bisa disetujui massal dan dikembalikan
// sebagai `dilewati` agar leader memeriksanya satu per satu. Leader tidak bisa menyetujui barisnya sendiri.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateManpowerLeader } from '$lib/server/manpowerLeaderGuard';
import { directusServerJson } from '$lib/server/directus';
import { absensiNormal } from '$lib/shared/kioskFlags';
import { idOf } from '$lib/server/manpowerAbsensiCore';
import { invalidateRoster } from '$lib/server/kioskProyekDevice';

const MAKS_PER_PANGGILAN = 200;

export const POST: RequestHandler = async (event) => {
	let body: any;
	try {
		body = await event.request.json();
	} catch {
		throw error(400, 'Body harus JSON.');
	}
	const projectId = Number(body?.project_id);
	if (!Number.isInteger(projectId) || projectId <= 0) throw error(400, 'project_id tidak valid.');
	const ids = [...new Set((Array.isArray(body?.ids) ? body.ids : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0))] as number[];
	if (!ids.length) throw error(400, 'Pilih minimal satu absensi.');
	if (ids.length > MAKS_PER_PANGGILAN) throw error(400, `Maksimal ${MAKS_PER_PANGGILAN} absensi per sekali setuju.`);

	const { manpower } = await authenticateManpowerLeader(event, projectId);

	// Satu query baca (proyek ini saja — id dari proyek lain otomatis tidak ikut), satu tulis.
	const res = await directusServerJson<{ data: any[] }>(
		`/items/manpower_absensi?filter[project_id][_eq]=${projectId}&filter[id][_in]=${ids.join(',')}` +
			`&fields=id,manpower_id,status,jam_pulang,masuk_valid,pulang_valid,dobel_proyek_flag,dikunci,verifikasi_leader_status,verifikasi_leader_catatan&limit=-1`
	);
	const rows = res?.data || [];

	const setuju: number[] = [];
	const dilewati: Array<{ id: number; alasan: string }> = [];
	const ditemukan = new Set(rows.map((r) => Number(r.id)));
	for (const id of ids) if (!ditemukan.has(id)) dilewati.push({ id, alasan: 'tidak ditemukan di proyek ini' });

	for (const r of rows) {
		if (Number(idOf(r.manpower_id)) === Number(manpower.id)) dilewati.push({ id: r.id, alasan: 'absensi Anda sendiri' });
		else if (!absensiNormal(r)) dilewati.push({ id: r.id, alasan: 'perlu diperiksa satu per satu' });
		else setuju.push(r.id);
	}

	if (setuju.length) {
		await directusServerJson('/items/manpower_absensi', {
			method: 'PATCH',
			body: JSON.stringify({
				keys: setuju,
				data: {
					verifikasi_leader_status: 'disetujui',
					verifikasi_leader_oleh: manpower.id,
					verifikasi_leader_at: new Date().toISOString(),
					verifikasi_leader_catatan: ''
				}
			})
		});
		invalidateRoster(projectId);
	}

	return json({ ok: true, disetujui: setuju.length, dilewati });
};
