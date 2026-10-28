// src/routes/api/gates/fix/ktp-nik/+server.ts
// Gate Transparan & Popup Benahi Data, Fase 3 — aksi "Benahi Inline" A (KTP + NIK).
//
// Leader mengisi NIK + unggah foto KTP pekerja timnya sendiri langsung dari popup gate,
// TANPA jalur tulis baru: dua write ini adalah PERSIS yang sudah dipakai
// manpower/daftar-baru (manpowerLeader.ts::createManpowerDokumen + updateManpower),
// cuma dipanggil dari titik lain. manpower_dokumen selalu lahir status_verifikasi
// 'menunggu' -- artinya submission ini TIDAK langsung meloloskan gate manapun, harus
// diverifikasi HRD dulu (jawaban implisit Q2b: ikut pola yang sudah ada, bukan jalur pintas
// baru). Tidak ada jalur bypass/pengecualian di sini (keputusan Q2, plan Fase 3).
//
// NIK: kolom `manpower.NIK` diperbaiki dari integer -> varchar (16 Sep 2026) supaya nomor
// dengan kode provinsi 91-94 tidak berisiko presisi hilang lewat JS. Validasi di sini tetap
// wajib 16 digit angka sebagai string.

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { authenticateProjectLeaderForManpower } from '$lib/server/projectLeaderGuard';
import { directusServerJson } from '$lib/server/directus';

const NIK_PATTERN = /^\d{16}$/;

export async function POST(event: RequestEvent) {
	const body = await event.request.json().catch(() => ({}));
	const manpowerId = Number(body.manpowerId);
	const nik = String(body.nik || '').trim();
	const fotoKtpFileId = String(body.fotoKtpFileId || '').trim();

	if (!manpowerId) throw error(400, 'manpowerId wajib.');
	if (!NIK_PATTERN.test(nik)) throw error(400, 'NIK wajib 16 digit angka.');
	if (!fotoKtpFileId) throw error(400, 'Foto KTP wajib diunggah (fotoKtpFileId kosong).');

	await authenticateProjectLeaderForManpower(event, manpowerId);

	await directusServerJson(`/items/manpower/${manpowerId}`, {
		method: 'PATCH',
		body: JSON.stringify({ NIK: nik })
	});

	const dokumen = await directusServerJson<{ data: { id: number } }>('/items/manpower_dokumen', {
		method: 'POST',
		body: JSON.stringify({
			manpower_id: manpowerId,
			jenis_dokumen: 'ktp',
			file: fotoKtpFileId,
			status_verifikasi: 'menunggu'
		})
	});

	return json({
		ok: true,
		manpowerDokumenId: dokumen?.data?.id ?? null,
		note: 'NIK tersimpan. Foto KTP masuk antrean verifikasi HRD.'
	});
}
