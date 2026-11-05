// src/routes/api/manpower-leader/absen-regu/+server.ts
// Absensi representatif oleh Manpower Leader.
// Dokumen: erp-epi-1/docs/rencana-manpower-leader.md
//
// Kenapa di server, bukan di halaman /regu:
//   - absensi memicu akrual biaya (project_expenses) — ini jalur uang;
//   - aturan repo ini eksplisit: "Perhitungan jarak WAJIB di server — jangan pernah
//     percaya validasi klien" (src/lib/server/ess/geo.ts);
//   - kalau klien yang menulis, siapa pun bisa mengirim masuk_valid: true tanpa
//     benar-benar berada di lokasi, dan bukti foto/GPS jadi hiasan belaka.
//
// Logika penulisan (penugasan, masa sementara, geofence, upsert, akrual) ada di
// $lib/server/manpowerAbsensiCore — dipakai bersama dengan kiosk proyek
// (/api/kiosk-proyek/absen) supaya jalur uang ini tidak bercabang. File ini hanya:
// parse form → autentikasi leader → panggil inti.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateManpowerLeader } from '$lib/server/manpowerLeaderGuard';
import { STATUS_SAH, catatAbsenMasuk } from '$lib/server/manpowerAbsensiCore';

export const POST: RequestHandler = async (event) => {
	const form = await event.request.formData();

	const projectId = Number(form.get('project_id'));
	const assignmentId = Number(form.get('assignment_id'));
	const targetManpowerId = Number(form.get('manpower_id'));
	const status = String(form.get('status') || '');
	const tanggal = String(form.get('tanggal') || '');
	const lat = Number(form.get('lat'));
	const lng = Number(form.get('lng'));
	const accuracy = form.get('accuracy') != null ? Number(form.get('accuracy')) : null;
	const foto = form.get('foto');

	if (!Number.isFinite(projectId) || !Number.isFinite(assignmentId) || !Number.isFinite(targetManpowerId)) {
		throw error(400, 'project_id, assignment_id, dan manpower_id wajib diisi.');
	}
	if (!STATUS_SAH.includes(status)) throw error(400, `Status tidak dikenal: ${status}`);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) throw error(400, 'Tanggal tidak valid.');

	// Lapis 1 & 2: akun → manpower, dan wajib pegang kursi di proyek ini.
	const { manpower, project } = await authenticateManpowerLeader(event, projectId);

	// Aturan: leader tidak mengabsenkan dirinya sendiri lewat jalur ini — absensi
	// pribadi tetap mandiri (ESS), supaya jejaknya tidak jadi "dicatat leader" oleh diri sendiri.
	if (Number(targetManpowerId) === Number(manpower.id)) {
		throw error(400, 'Absensi Anda sendiri lewat Absensi Mandiri (ESS), bukan dari layar regu.');
	}

	const r = await catatAbsenMasuk({
		projectId,
		project,
		assignmentId,
		targetManpowerId,
		status,
		tanggal,
		lat,
		lng,
		accuracy,
		foto,
		pencatat: { metode: 'leader', nama: manpower.nama || '', manpowerId: manpower.id },
		existingPolicy: 'overwrite'
	});

	return json({
		success: true,
		absensiId: r.absensiId,
		masuk_valid: r.masuk_valid,
		jarak_m: r.jarak_m,
		accuracy: r.accuracy,
		message: r.message
	});
};
