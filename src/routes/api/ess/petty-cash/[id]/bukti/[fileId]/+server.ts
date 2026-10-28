// src/routes/api/ess/petty-cash/[id]/bukti/[fileId]/+server.ts
// PC3-20 U2 — foto nota tiket kas kecil untuk kartu atasan. Diakses lewat route SERVER yang memeriksa hak
// (pemohon / atasan / kasir tiket) dan memastikan fileId memang lampiran tiket itu — BUKAN proxy Directus terbuka.
// Diminta lazy oleh klien (saat "Lihat nota" ditekan) supaya hemat kuota di sinyal lemah.

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerFetch } from '$lib/server/directus';
import { loadRequest, asId } from '$lib/server/ess/pettyCashRequest';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const row = await loadRequest(event.params.id!);
	if (!row) throw error(404, 'Pengajuan tidak ditemukan.');

	const me = karyawan.id;
	const allowed = [asId(row.requester_karyawan_id), asId(row.atasan_karyawan_id), asId(row.kasir_karyawan_id)].some((x) => x != null && x === me);
	if (!allowed) throw error(403, 'Anda tidak berhak melihat lampiran pengajuan ini.');

	const fileId = event.params.fileId!;
	const attached = [
		...(Array.isArray(row.bukti_file) ? row.bukti_file : []),
		...(Array.isArray(row.lpj_bukti_file) ? row.lpj_bukti_file : [])
	].map(String);
	if (!attached.includes(String(fileId))) throw error(404, 'Lampiran tidak ditemukan pada pengajuan ini.');

	// ukuran dibatasi (pratinjau nota cukup 1200px) → hemat kuota atasan di lokasi
	const res = await directusServerFetch(`/assets/${encodeURIComponent(fileId)}?width=1200&quality=80&fit=inside`);
	if (!res.ok) {
		console.error(`[ess/petty-cash] gagal ambil aset nota ${fileId}: HTTP ${res.status}`);
		throw error(502, 'Foto nota tidak bisa dimuat sekarang. Coba lagi.');
	}
	return new Response(res.body, {
		headers: {
			'Content-Type': res.headers.get('content-type') || 'image/jpeg',
			'Cache-Control': 'private, max-age=300'
		}
	});
};
