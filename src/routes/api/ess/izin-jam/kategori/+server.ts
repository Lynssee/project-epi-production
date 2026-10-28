// src/routes/api/ess/izin-jam/kategori/+server.ts
// ESS HRD v3 Fase 2 — daftar kategori izin per-jam aktif (dari cuti_kategori, bukan
// hardcoded array — Fase 2 adalah konsumen pertama cuti_kategori dari sisi ESS).
//
// Difilter by kode, bukan kelompok/maks_durasi_jam: kelompok='izin' juga dipakai
// kategori izin hari-penuh existing (izin_sakit_tanpa_surat, izin_penting), dan
// izin_darurat sengaja punya maks_durasi_jam=null ("sisa hari kerja", tidak dibatasi
// kaku) jadi tidak bisa dipakai sebagai filter pembeda juga. 4 kode di bawah adalah
// yang di-seed setup-izin-jam-fase2.js — daftar tertutup, aman di-hardcode di sini.

import { json, type RequestEvent } from '@sveltejs/kit';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

const KODE_IZIN_JAM = ['izin_dinas', 'izin_pribadi', 'cuti_jam', 'izin_darurat'];

export async function GET(event: RequestEvent) {
	await authenticateEss(event);

	const query = new URLSearchParams({
		'filter[kode][_in]': KODE_IZIN_JAM.join(','),
		'filter[aktif][_eq]': 'true',
		fields: 'id,kode,nama,keterangan,maks_durasi_jam,kuota_jam_per_bulan,berbayar',
		sort: 'urutan'
	});
	const result = await directusServerJson(`/items/cuti_kategori?${query.toString()}`);
	return json({ data: result?.data || [] });
}
