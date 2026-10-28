// src/routes/api/ess/shift-roster/tukar-konfirmasi/+server.ts
// ESS HRD v3 Fase 3 Modul 4 — karyawan B (target tukar) konfirmasi permintaan A.
// Setelah konfirmasi, baru masuk Universal Approval Engine ke atasan (pola persis
// izin-jam/submit Fase 2) — callback_url selalu ke erp-epi-1 (createApprovalRequest
// dari sini hanya MENERBITKAN request; keputusan tetap di admin dashboard erp-epi-1).

import { error, json, type RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { createApprovalRequest } from '$lib/server/approvalSubmit';

const ERP_EPI_1_ORIGIN = env.ERP_EPI1_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://internal.eltamaprimaindo.com' : 'http://localhost:9390');

export async function POST(event: RequestEvent) {
	const { karyawan } = await authenticateEss(event);

	const body = await event.request.json().catch(() => ({}));
	const { rosterId } = body;
	if (!rosterId) throw error(400, 'rosterId wajib diisi.');

	const rosterRes = await directusServerJson<{
		data: { id: string; karyawan_id: number; swap_with: number; status: string; tanggal: string };
	}>(`/items/shift_roster/${rosterId}?fields=id,karyawan_id,swap_with,status,tanggal`);
	const roster = rosterRes?.data;
	if (!roster) throw error(404, 'Roster tidak ditemukan.');
	if (Number(roster.swap_with) !== karyawan.id) {
		throw error(403, 'Anda bukan tujuan permintaan tukar shift ini.');
	}
	if (roster.status !== 'menunggu_tukar') {
		throw error(409, `Roster ini berstatus ${roster.status}, tidak bisa dikonfirmasi.`);
	}

	const pemohonRes = await directusServerJson<{ data: { id: number; nama_karyawan: string; divisi: string | null } }>(
		`/items/karyawan/${roster.karyawan_id}?fields=id,nama_karyawan,divisi`
	);
	const pemohon = pemohonRes?.data;
	if (!pemohon) throw error(404, 'Karyawan pemohon tidak ditemukan.');

	const approvalRequest = await createApprovalRequest({
		moduleKey: 'shift_swap',
		sourceCollection: 'shift_roster',
		sourceId: rosterId,
		title: `Tukar Shift ${roster.tanggal}`,
		summary: `${pemohon.nama_karyawan} tukar shift dengan ${karyawan.nama_karyawan} pada ${roster.tanggal}`,
		departmentKey: pemohon.divisi || undefined,
		requesterId: pemohon.id,
		callbackUrl: `${ERP_EPI_1_ORIGIN}/api/shift-roster/approval-callback`,
		payload: { rekanKaryawanId: karyawan.id }
	});

	if (approvalRequest?.id) {
		await directusServerJson(`/items/shift_roster/${rosterId}`, {
			method: 'PATCH',
			body: JSON.stringify({ approval_request_id: approvalRequest.id })
		});
	}

	return json({ success: true, status: 'menunggu_tukar', approvalRequestId: approvalRequest?.id || null });
}
