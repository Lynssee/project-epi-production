// src/routes/api/rekening-penerima/search/+server.ts
// Penajaman Penerima Dana & Track Record v2, Fase 4 (11 Sep 2026) — versi RINGAN
// untuk dashboard lapangan (kembaran erp-epi api/rekening-penerima/search, tanpa
// grup karyawan/manpower/vendor — pekerja lapangan tidak browse master data orang lain).
//
// GET ?q=<teks> -> { terdaftar, tooShort? }
// GET (tanpa q, atau bersamaan) -> selalu sertakan `terakhirSaya`: 5 rekening
// terakhir yang PERNAH dipakai pengaju ini (created_by_email), untuk "1 tap pakai lagi".
// Rekening SELALU tersamar (4 digit terakhir) — pola sama erp-epi.

import { json, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';
import { normalizeRekening } from '$lib/shared/rekeningCore.js';
import { maskRekeningNorm } from '$lib/server/rekeningPenerimaServer';

function mapReg(r: any) {
	return {
		id: r.id,
		bank_kode: r.bank_kode,
		bank_label: r.bank_nama_raw || r.bank_kode,
		rekening_mask: maskRekeningNorm(r.rekening_norm),
		atas_nama: r.atas_nama,
		status_verifikasi: r.status_verifikasi,
		status: r.status,
		blokir_alasan: r.blokir_alasan
	};
}

export async function GET(event: RequestEvent) {
	const user = await requireUser(event);
	const q = (event.url.searchParams.get('q') || '').trim();
	const qDigits = normalizeRekening(q);

	// "Rekening terakhir saya" — dari riwayat PA milik pengaju ini, terlepas dari q,
	// supaya tetap tampil begitu form dibuka (1 tap pakai lagi).
	const recentPaRes = await directusServerJson<{ data: any[] }>(
		`/items/pengajuan_anggaran?filter[created_by_email][_eq]=${encodeURIComponent(user.email)}&filter[rekening_penerima_id][_nnull]=true&sort=-date_created&fields=rekening_penerima_id&limit=20`
	).catch(() => ({ data: [] }));
	const recentIds = [...new Set((recentPaRes?.data || []).map((r: any) => r.rekening_penerima_id))].slice(0, 5);

	let terakhirSaya: any[] = [];
	if (recentIds.length) {
		const idsFilter = encodeURIComponent(JSON.stringify({ id: { _in: recentIds } }));
		const res = await directusServerJson<{ data: any[] }>(
			`/items/rekening_penerima?filter=${idsFilter}&fields=id,bank_kode,bank_nama_raw,rekening_norm,atas_nama,status_verifikasi,status,blokir_alasan&limit=5`
		).catch(() => ({ data: [] }));
		// urutan sesuai recentIds (terbaru dulu)
		const byId = new Map((res?.data || []).map((r: any) => [r.id, r]));
		terakhirSaya = recentIds.map((id) => byId.get(id)).filter(Boolean).map(mapReg);
	}

	if (q.length < 2) {
		return json({ terdaftar: [], terakhirSaya, tooShort: true });
	}

	const filterObj = {
		_or: [
			{ atas_nama: { _icontains: q } },
			{ bank_nama_raw: { _icontains: q } },
			...(qDigits.length >= 3 ? [{ rekening_norm: { _icontains: qDigits } }] : [])
		]
	};
	const res = await directusServerJson<{ data: any[] }>(
		`/items/rekening_penerima?filter=${encodeURIComponent(JSON.stringify(filterObj))}&fields=id,bank_kode,bank_nama_raw,rekening_norm,atas_nama,status_verifikasi,status,blokir_alasan&limit=8`
	).catch(() => ({ data: [] }));

	return json({ terdaftar: (res?.data || []).map(mapReg), terakhirSaya });
}
