// src/routes/api/proyek/kontrak/bast-followup/+server.ts
// Modul 4 (Dashboard Lapangan — Kontrak View), §7 FL3 Penajaman Sistem AR v2 (26 Agu 2026) —
// Project Leader unggah bukti pengiriman BAST ke pelanggan (foto tanda terima / screenshot
// email/WA). Menulis satu baris `penagihan_followup` (ref_type='bast'), BUKAN mengubah status
// BAST itu sendiri — ini mengisi bukti E2 di stalledBillingEngine.js sisi Admin ERP, supaya
// klaim "salah customer" di Papan Keputusan Proyek Tersandera punya dasar dokumenter.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateProjectLeader, isProjectAllowed } from '$lib/server/goodsReceived/guard';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';

const VALID_CHANNELS = ['wa', 'email', 'visit', 'other'];

export const POST: RequestHandler = async (event) => {
	const { karyawan, projectIds } = await authenticateProjectLeader(event);

	const form = await event.request.formData().catch(() => null);
	if (!form) throw error(400, 'Form data tidak valid.');

	const projectId = Number(form.get('projectId'));
	const terminId = form.get('terminId') ? String(form.get('terminId')) : null;
	const channel = String(form.get('channel') || '').trim();
	const contactPerson = String(form.get('contactPerson') || '').trim();
	const bukti = form.get('bukti'); // File

	if (!projectId) throw error(400, 'projectId wajib diisi');
	if (!isProjectAllowed(projectIds, projectId)) {
		throw error(403, 'Anda bukan Project Leader untuk proyek ini');
	}
	if (!VALID_CHANNELS.includes(channel)) throw error(400, 'channel tidak valid');
	if (!(bukti instanceof File) || bukti.size === 0) throw error(400, 'Bukti (foto/screenshot) wajib diunggah');

	// Cari BAST terkait termin ini (kalau ada) supaya bukti bisa ditautkan ke bukti E2
	// stalledBillingEngine.js. Kalau termin belum punya BAST sama sekali, bukti tetap
	// dicatat (ref_id null) — lebih baik tercatat daripada hilang, tapi tidak akan
	// terhitung E2 sampai BAST-nya ada.
	let bastId: number | null = null;
	if (terminId) {
		const bastRes = await directusServerJson<{ data: any[] }>(
			`/items/bast?filter[termin_id][_eq]=${encodeURIComponent(terminId)}&sort=-id&limit=1&fields=id`
		);
		bastId = bastRes?.data?.[0]?.id ?? null;
	}

	const uploadForm = new FormData();
	uploadForm.append('file', bukti);
	const uploadRes = await directusServerUpload(uploadForm);
	if (!uploadRes.ok) throw error(502, 'Gagal mengunggah bukti pengiriman BAST.');
	const uploaded = await uploadRes.json();
	const fileId = uploaded?.data?.id;
	if (!fileId) throw error(502, 'Upload berhasil tapi file_id tidak diterima Directus.');

	const project = await directusServerJson<{ data: any }>(`/items/projects/${projectId}?fields=id,name`);

	const created = await directusServerJson<{ data: any }>('/items/penagihan_followup', {
		method: 'POST',
		body: JSON.stringify({
			arah: 'AR',
			ref_type: 'bast',
			ref_id: bastId,
			party_name: project?.data?.name || null,
			follow_up_date: new Date().toISOString().split('T')[0],
			channel,
			contact_person: contactPerson || null,
			bukti_file_id: fileId,
			status: 'pending',
			notes: `Bukti pengiriman BAST diunggah dari lapangan oleh ${karyawan.nama_karyawan}`,
			created_by_name: karyawan.nama_karyawan
		})
	});

	return json({ success: true, data: created?.data });
};
