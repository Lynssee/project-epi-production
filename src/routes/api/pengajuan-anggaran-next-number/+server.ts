// src/routes/api/pengajuan-anggaran-next-number/+server.ts
// Alokasi nomor urut pengajuan anggaran (PA-YYMM-XXXX) sisi SERVER.
//
// Latar belakang (audit 16 Sep 2026):
// Pengamanan RLS pengajuanAnggaranGuard.ts di proxy /api/directus membatasi
// pembacaan pengajuan_anggaran hanya pada proyek user. Akibatnya,
// generatePengajuanAnggaranNumber() di browser klien hanya melihat nomor
// miliknya sendiri dan menghasilkan nomor yang sudah dipakai orang lain
// (bentrok unique constraint Directus, contoh kasus PA-2609-0070).
//
// Endpoint ini menggunakan token server (admin Directus) sehingga dapat
// membaca nomor urut tertinggi secara global lintas divisi/proyek,
// cepat (sort=-nomor_pengajuan&limit=10), dan kebal terhadap filter proyek perorangan.

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';

export async function GET(event: RequestEvent) {
	await requireUser(event);

	const now = new Date();
	const yy = String(now.getFullYear()).slice(-2);
	const mm = String(now.getMonth() + 1).padStart(2, '0');
	const prefix = `PA-${yy}${mm}`;

	try {
		// Ambil 10 baris nomor terbaru berawalan PA-YYMM untuk mendeteksi max sequence
		const res: any = await directusServerJson(
			`/items/pengajuan_anggaran?limit=10&sort=-nomor_pengajuan&fields=nomor_pengajuan&filter[nomor_pengajuan][_starts_with]=${encodeURIComponent(prefix)}`
		);

		let maxSeq = 0;
		if (Array.isArray(res?.data)) {
			for (const item of res.data) {
				const nomor = String(item?.nomor_pengajuan || '').trim();
				const parts = nomor.split('-');
				const seq = parseInt(parts[parts.length - 1], 10);
				if (!isNaN(seq) && seq > maxSeq) {
					maxSeq = seq;
				}
			}
		}

		let candidate = `${prefix}-${String(maxSeq + 1).padStart(4, '0')}`;

		// Pre-check cepat untuk memastikan nomor kandidat benar-benar belum terpakai
		for (let checkAttempt = 0; checkAttempt < 5; checkAttempt++) {
			const checkRes: any = await directusServerJson(
				`/items/pengajuan_anggaran?limit=1&fields=id&filter[nomor_pengajuan][_eq]=${encodeURIComponent(candidate)}`
			);
			if (Array.isArray(checkRes?.data) && checkRes.data.length > 0) {
				maxSeq++;
				candidate = `${prefix}-${String(maxSeq + 1).padStart(4, '0')}`;
			} else {
				break;
			}
		}

		return json({
			nomor_pengajuan: candidate,
			prefix,
			max_seq: maxSeq
		});
	} catch (e: any) {
		console.error('[pengajuan-anggaran-next-number] Gagal mengalokasikan nomor:', e);
		throw error(500, e?.message || 'Gagal mengalokasikan nomor pengajuan anggaran');
	}
}
