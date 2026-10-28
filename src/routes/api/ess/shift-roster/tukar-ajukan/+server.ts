// src/routes/api/ess/shift-roster/tukar-ajukan/+server.ts
// ESS HRD v3 Fase 3 Modul 4 — karyawan A ajukan tukar shift tanggal tertentu ke
// karyawan B. Status jadi 'menunggu_tukar' — belum masuk Universal Approval Engine
// sampai B konfirmasi (lihat tukar-konfirmasi/+server.ts).

import { error, json, type RequestEvent } from '@sveltejs/kit';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

export async function POST(event: RequestEvent) {
	const { karyawan } = await authenticateEss(event);

	const body = await event.request.json().catch(() => ({}));
	const { rosterId, karyawanTujuanId } = body;
	if (!rosterId || !karyawanTujuanId) {
		throw error(400, 'rosterId dan karyawanTujuanId wajib diisi.');
	}

	const rosterRes = await directusServerJson<{ data: { id: string; karyawan_id: number; status: string } }>(
		`/items/shift_roster/${rosterId}?fields=id,karyawan_id,status`
	);
	const roster = rosterRes?.data;
	if (!roster) throw error(404, 'Roster tidak ditemukan.');
	if (Number(roster.karyawan_id) !== karyawan.id) {
		throw error(403, 'Anda hanya bisa mengajukan tukar utk shift Anda sendiri.');
	}
	if (roster.status !== 'aktif') {
		throw error(409, `Roster ini sudah berstatus ${roster.status}, tidak bisa diajukan tukar.`);
	}

	await directusServerJson(`/items/shift_roster/${rosterId}`, {
		method: 'PATCH',
		body: JSON.stringify({ status: 'menunggu_tukar', is_swap: true, swap_with: karyawanTujuanId })
	});

	// Notifikasi in-app ke karyawan tujuan — project-epi tidak punya sendFonnte (WA hanya
	// ada di erp-epi-1), jadi cukup app_notifications dulu (konsisten dgn gap yang sudah
	// dicatat di Fase 2 izin-jam gate-scan).
	try {
		await directusServerJson('/items/app_notifications', {
			method: 'POST',
			body: JSON.stringify({
				type: 'shift_swap_request',
				title: 'Permintaan Tukar Shift',
				message: `${karyawan.nama_karyawan} mengajukan tukar shift dengan Anda. Silakan konfirmasi di ESS.`,
				priority: 'medium',
				karyawan_id: karyawanTujuanId,
				source_collection: 'shift_roster',
				source_id: String(rosterId),
				read: false,
				created_at: new Date().toISOString()
			})
		});
	} catch {
		// non-fatal — notifikasi gagal tidak boleh membatalkan pengajuan tukar
	}

	return json({ success: true, status: 'menunggu_tukar' });
}
