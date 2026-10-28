// src/routes/api/rekening-penerima/register/+server.ts
// Penajaman Penerima Dana & Track Record v2, Fase 4 (11 Sep 2026) — versi lapangan.
//
// DUA MODE:
//   1) { selectRekeningPenerimaId } — pilih dari "Terdaftar" / "Rekening terakhir saya".
//      Level akses sama dengan erp-epi: nomor utuh dikembalikan HANYA saat baris
//      spesifik dipilih, bukan saat sekadar muncul di hasil cari (yang tersamar).
//   2) { bankNameRaw, rekeningRaw, atasNama } — daftar baru, diketik manual di form.
//      sumber='form_lapangan', status_verifikasi='belum' SELALU (keputusan user §9.4:
//      rekening baru dari lapangan WAJIB verifikasi Finance dulu — klien menampilkan
//      peringatan tegas, TIDAK memblokir submit PA sepenuhnya (Aturan #6: jangan matikan
//      tombol tanpa alternatif — konsisten dengan semua gate G_REK_* lain yang shadow).

import { json, error, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';
import { ensureRekening } from '$lib/server/rekeningPenerimaServer';

export async function POST(event: RequestEvent) {
	await requireUser(event);
	const body = await event.request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Body tidak valid');

	if (body.selectRekeningPenerimaId != null) {
		const res = await directusServerJson<{ data: any }>(`/items/rekening_penerima/${body.selectRekeningPenerimaId}`).catch(() => null);
		const row = res?.data;
		if (!row) throw error(404, 'Rekening tidak ditemukan di registri');
		if (row.status === 'diblokir') {
			throw error(422, `Rekening ini diblokir${row.blokir_alasan ? `: ${row.blokir_alasan}` : ''} — tidak bisa dipakai.`);
		}
		return json({ success: true, data: row });
	}

	const { bankNameRaw, rekeningRaw, atasNama } = body;
	if (!rekeningRaw) throw error(400, 'Nomor rekening wajib diisi');
	const row = await ensureRekening({
		bankNameRaw,
		rekeningRaw,
		atasNama,
		pemilikTipe: 'pihak_lain',
		sumber: 'form_lapangan'
	});
	if (!row) {
		throw error(422, 'Rekening ini terdeteksi sebagai Tagihan/Virtual Account — tidak perlu didaftarkan, pilih toggle "Tagihan/VA" di form.');
	}
	return json({ success: true, data: row });
}
