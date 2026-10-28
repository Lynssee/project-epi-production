// src/routes/api/stock-lapangan/cek-area/+server.ts
// Fase 3 (Rencana Sistem Penempatan Area Inventory & Verifikasi Barcode v2, 20 Agu 2026):
// submit verifikasi/cek-area rak dari lapangan. Identitas pemohon (verified_by) di-resolve
// SERVER-SIDE dari Firebase (pola sama seperti /api/sji) -- klien tidak pernah dipercaya
// mengaku sebagai orang lain. Otorisasi PIC/SPV (Q2) digerbangi di klien (tombol submit
// disembunyikan) -- pola yang sama dipakai /api/sji, bukan pelonggaran baru.
//
// GERBANG STOK (§ dokumen rencana Fase 3): endpoint ini TIDAK PERNAH menulis stock_transactions
// atau mengubah stok. Hasil hanya laporan (gudang_verifikasi/gudang_verifikasi_item) untuk
// dibaca admin -- penyesuaian stok kalau diperlukan tetap lewat jalur manual yang sudah ada.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { directusServerJson } from '$lib/server/directus';

async function resolveKaryawan(user: { localId: string; email: string }) {
	const byUid = await getKaryawanByFirebaseUid(user.localId).catch(() => null);
	if (byUid) return byUid;
	return resolveKaryawanByEmail(user.email);
}

interface ItemPayload {
	identitas_barang_id: number;
	expected_qty: number | null;
	actual_qty: number;
	jenis_masalah?: string | null;
	severity?: string | null;
	deskripsi?: string | null;
}

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);
	if (!karyawan) throw error(403, 'Data karyawan tidak ditemukan untuk akun ini.');

	const body = await event.request.json();
	const gudangId = Number(body?.gudang_id);
	const items: ItemPayload[] = Array.isArray(body?.items) ? body.items : [];
	const clientTxnId = String(body?.client_txn_id || '');
	if (!gudangId || !items.length || !clientTxnId) {
		throw error(400, 'gudang_id, items, dan client_txn_id wajib diisi.');
	}

	// Idempotensi: cek dulu header dengan client_txn_id yang sama (query-based, bukan
	// constraint DB -- cukup untuk kasus retry/klik ganda manusia, lihat catatan file ini).
	const existingRes = await directusServerJson<{ data: any[] }>(
		`/items/gudang_verifikasi?filter[client_txn_id][_eq]=${encodeURIComponent(clientTxnId)}&limit=1`
	);
	if (existingRes?.data?.[0]) {
		return json({ success: true, id: existingRes.data[0].id, deduped: true });
	}

	let matchCount = 0;
	let selisihCount = 0;
	let mismatchCount = 0;
	const detailRows = items.map((it) => {
		const expected = it.expected_qty ?? 0;
		const actual = Number(it.actual_qty) || 0;
		const selisih = actual - expected;
		let status = 'open';
		if (selisih === 0 && !it.jenis_masalah) matchCount++;
		else if (it.jenis_masalah === 'tidak_ada' || it.jenis_masalah === 'salah_item' || it.jenis_masalah === 'rusak') mismatchCount++;
		else selisihCount++;
		return {
			gudang_id: gudangId,
			identitas_barang_id: it.identitas_barang_id,
			expected_qty: it.expected_qty,
			actual_qty: actual,
			selisih,
			jenis_masalah: it.jenis_masalah || null,
			severity: it.severity || (it.jenis_masalah ? 'medium' : null),
			status: it.jenis_masalah ? 'open' : 'closed',
			deskripsi: it.deskripsi || null
		};
	});

	const headerStatus = mismatchCount > 0 ? 'mismatch' : selisihCount > 0 ? 'selisih' : 'match';

	const headerRes = await directusServerJson<{ data: any }>('/items/gudang_verifikasi', {
		method: 'POST',
		body: JSON.stringify({
			gudang_id: gudangId,
			verified_by: karyawan.id,
			jenis: body.jenis || 'genba',
			status: headerStatus,
			total_item: items.length,
			match_count: matchCount,
			selisih_count: selisihCount + mismatchCount,
			catatan: body.catatan || null,
			foto_kondisi: body.foto_kondisi || null,
			gps_lat: body.gps_lat ?? null,
			gps_lng: body.gps_lng ?? null,
			source: body.source || 'field:scan',
			client_txn_id: clientTxnId
		})
	});
	const verifikasiId = headerRes?.data?.id;

	for (const row of detailRows) {
		await directusServerJson('/items/gudang_verifikasi_item', {
			method: 'POST',
			body: JSON.stringify({ ...row, verifikasi_id: verifikasiId, pic_notified: null })
		});
	}

	return json({ success: true, id: verifikasiId, status: headerStatus });
};
