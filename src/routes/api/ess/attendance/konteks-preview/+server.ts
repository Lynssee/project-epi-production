// src/routes/api/ess/attendance/konteks-preview/+server.ts
// Rencana v2 §5 Fase 2 — chip konteks otomatis SEBELUM submit, supaya karyawan mobile bisa
// menekan "Ubah lokasi" untuk mengoreksi kalau deteksi salah (lihat gap yang tadinya cuma
// tampil setelah absen berhasil, sekarang dipanggil begitu GPS didapat, sebelum tombol kirim).
// Gagal-lunak murni: kegagalan di sini TIDAK PERNAH memblokir absen, klien cukup sembunyikan
// chip bila endpoint ini gagal.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { previewKonteksLokasi } from '$lib/server/ess/istirahatMobileContext';
import { resolveKaryawanPolaKerja } from '$lib/server/ess/polaKerjaResolver';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const body = await event.request.json().catch(() => null);
	const lat = Number(body?.lat);
	const lng = Number(body?.lng);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
		throw error(400, 'Lokasi GPS tidak valid.');
	}

	const polaKerja = await resolveKaryawanPolaKerja(karyawan.id);
	if (polaKerja !== 'mobile') {
		// Chip konteks hanya relevan utk pola kerja mobile — pola lain tidak perlu pratinjau ini.
		return json({ konteksLokasi: null, konteksSumber: null });
	}

	const hasil = await previewKonteksLokasi(karyawan.id, lat, lng);
	return json(hasil);
};
