// src/routes/api/kiosk-proyek/barang/+server.ts
// Daftar barang stok proyek yang boleh diajukan kru di "Pakai Barang" (Rencana Kiosk Proyek, Fase 5).
// Sumber: baris RAP Actual (project_expenses) dengan sisa > 0 — daftar yang sama dengan form material di Laporan Harian.
// Cache server (kiosk_proyek.roster_cache_detik); satu request per buka lembar.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authPerangkatKiosk } from '$lib/server/kioskProyekAuth';
import { daftarBarangProyek } from '$lib/server/kioskPemakaian';

export const GET: RequestHandler = async (event) => {
	const auth = await authPerangkatKiosk(event);
	if (!auth.ok) return auth.response;
	if (!auth.settings['kiosk_proyek.pemakaian_aktif']) throw error(403, 'Pakai Barang sedang dimatikan oleh admin.');

	const barang = await daftarBarangProyek(auth.projectId, auth.settings['kiosk_proyek.roster_cache_detik']);
	return json(
		{ ok: true, barang: barang.map(({ expense_id, nama, satuan, sisa }) => ({ expense_id, nama, satuan, sisa })) },
		{ headers: { 'Cache-Control': 'no-store' } }
	);
};
