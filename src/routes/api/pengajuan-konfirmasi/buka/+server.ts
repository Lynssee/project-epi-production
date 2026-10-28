// src/routes/api/pengajuan-konfirmasi/buka/+server.ts
// Pengajuan Darurat Atas Nama — buka detail lewat tautan WhatsApp TANPA login.
// Syarat: token tautan valid & belum kedaluwarsa + 4 digit terakhir no_hp pemohon (master karyawan).
// Rate-limited; semua kegagalan token memakai pesan generik (tidak membocorkan alasan spesifik).

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { directusServerJson } from '$lib/server/directus';
import { isRateLimited } from '$lib/server/rateLimit';
import { cfg, idOf, loadRecord, buildDetail, checkTokenAccess } from '$lib/server/pengajuanKonfirmasi';

export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => ({}));
	const jenis = String(body?.jenis || '');
	const id = Number(body?.id);
	if ((jenis !== 'anggaran' && jenis !== 'pr') || !Number.isFinite(id) || id <= 0) throw error(400, 'Permintaan tidak valid.');

	const ip = event.getClientAddress?.() || 'unknown';
	if (isRateLimited(`konfirmasi-token-ip:${ip}`, { windowMs: 15 * 60_000, max: 40 }) || isRateLimited(`konfirmasi-token:${jenis}:${id}`, { windowMs: 15 * 60_000, max: 10 })) {
		throw error(429, 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi atau gunakan login dashboard lapangan.');
	}

	const rec = await loadRecord(jenis, id);
	const GENERIC = 'Tautan tidak valid atau sudah tidak berlaku. Buka lewat login dashboard lapangan atau minta admin mengirim ulang.';
	if (!rec || !rec.is_on_behalf) throw error(403, GENERIC);

	const pemohonId = idOf(rec[cfg(jenis).ownerField]);
	const pemohon = pemohonId
		? (await directusServerJson<any>(`/items/karyawan/${pemohonId}?fields=id,no_hp`).catch(() => null))?.data
		: null;
	const access = checkTokenAccess({
		storedHash: rec.pemohon_token,
		expiresAt: rec.pemohon_token_expires_at,
		givenToken: String(body?.token || ''),
		pemohonNoHp: pemohon?.no_hp,
		tail: String(body?.tail || '')
	});
	if (!access.ok) throw error(access.httpStatus, access.message);

	return json({ success: true, data: await buildDetail(jenis, rec) });
};
