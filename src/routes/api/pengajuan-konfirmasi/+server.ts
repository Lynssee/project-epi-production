// src/routes/api/pengajuan-konfirmasi/+server.ts
// Pengajuan Darurat Atas Nama — sisi pemohon lapangan.
//   GET            -> daftar PA/PR atas nama yang MENUNGGU konfirmasi saya (login)
//   GET ?jenis&id  -> detail untuk layar konfirmasi (login; hanya jika saya pemohonnya)
//   POST           -> proxy ke admin erp-epi (/api/pengajuan-anggaran/konfirmasi-pemohon). Dua jalur:
//                     login (Authorization diteruskan) ATAU tautan token ({token, tail}, tanpa login, hanya
//                     approve/reject). Semua aturan bisnis & verifikasi token ada di admin; di sini hanya
//                     rate-limit tambahan. Identitas SELALU dari token/login, bukan dari klien.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { isRateLimited } from '$lib/server/rateLimit';
import { STATUS_MENUNGGU, cfg, idOf, loadRecord, buildDetail } from '$lib/server/pengajuanKonfirmasi';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const jenis = event.url.searchParams.get('jenis');
	const id = Number(event.url.searchParams.get('id'));

	// ---- Daftar ----
	if (!jenis || !id) {
		const out: any[] = [];
		for (const j of ['anggaran', 'pr']) {
			const c = cfg(j);
			const res = await directusServerJson<any>(
				`/items/${c.collection}?filter[${c.ownerField}][_eq]=${karyawan.id}&filter[status][_eq]=${encodeURIComponent(STATUS_MENUNGGU)}&filter[pemohon_status][_eq]=menunggu&fields=id,tujuan_pengajuan,date_created${j === 'anggaran' ? ',nomor_pengajuan,total_amount' : ''}&sort=-date_created&limit=50`
			);
			for (const r of res?.data || []) out.push({ jenis: j, ...r });
		}
		return json({ success: true, data: out });
	}

	// ---- Detail ----
	if (jenis !== 'anggaran' && jenis !== 'pr') throw error(400, 'jenis tidak dikenal');
	const rec = await loadRecord(jenis, id);
	if (!rec) throw error(404, 'Pengajuan tidak ditemukan');
	if (!rec.is_on_behalf || String(idOf(rec[cfg(jenis).ownerField])) !== String(karyawan.id)) {
		throw error(403, 'Pengajuan ini bukan atas nama Anda.');
	}
	return json({ success: true, data: await buildDetail(jenis, rec) });
};

export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => ({}));
	const useToken = typeof body?.token === 'string' && body.token.length > 0;
	const authHeader = event.request.headers.get('authorization') || '';

	if (useToken) {
		// Tanpa login: batasi percobaan per IP dan per pengajuan (admin juga membatasi).
		const ip = event.getClientAddress?.() || 'unknown';
		if (isRateLimited(`konfirmasi-token-ip:${ip}`, { windowMs: 15 * 60_000, max: 40 }) || isRateLimited(`konfirmasi-token:${body?.jenis}:${body?.pengajuanId}`, { windowMs: 15 * 60_000, max: 10 })) {
			throw error(429, 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.');
		}
	} else {
		await authenticateEss(event); // pastikan login & terhubung ke karyawan
	}

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) throw error(503, 'Fitur ini belum dikonfigurasi (ERP_EPI1_BASE_URL kosong).');

	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/pengajuan-anggaran/konfirmasi-pemohon`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...(useToken ? {} : { Authorization: authHeader }) },
			body: JSON.stringify({
				jenis: body?.jenis,
				pengajuanId: body?.pengajuanId,
				action: body?.action,
				versi: body?.versi,
				note: body?.note,
				ttdDataUrl: body?.ttdDataUrl,
				...(useToken ? { token: body.token, tail: body?.tail } : {})
			}),
			signal: AbortSignal.timeout(25000)
		});
		const result = await res.json().catch(() => ({}));
		return json(result, { status: res.status });
	} catch (e: any) {
		console.warn('[pengajuan-konfirmasi] gagal menghubungi admin:', e?.message);
		return json({ success: false, message: 'Tidak dapat menghubungi admin saat ini. Coba lagi.' }, { status: 502 });
	}
};
