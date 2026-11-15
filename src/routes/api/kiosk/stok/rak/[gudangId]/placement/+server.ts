// src/routes/api/kiosk/stok/rak/[gudangId]/placement/+server.ts
// Kelola Rak (Kiosk Gudang): tempatkan barang ke rak ini (master gudang_item_placement).
// Atribusi badge dicatat ke scan_log.
//
// Revisi Nov 2026 — HITUNG FISIK LANGSUNG: tiap baris boleh membawa `hitung_fisik`. Setelah
// penempatan dibuat, hitungan dicatat lewat jalur yang SAMA dengan tombol "Input Hitung Fisik"
// (catatHitungFisikRak: sesi opname aktif → masuk sesi; selain itu adjustment langsung ke stok).
// Dulu angka di dialog ini hanya disimpan sebagai expected_qty (Rencana) — tidak pernah menjadi
// stok, sehingga operator mengira barang sudah terhitung padahal belum.
//
// Hak akses hitung fisik = aturan adjustment yang sudah ada (bolehAdjustRak: PIC rak / rak induk
// atau centang menu Hitung Stok), dicek SEBELUM penempatan dibuat supaya penolakan tidak
// meninggalkan setengah data. UI mengunci kolom untuk yang tidak berhak; server tetap menegakkan.

import { randomUUID } from 'node:crypto';
import { json, error, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { requireKioskMenu } from '$lib/server/kioskMenuAccess';
import { TAMBAH_PLACEMENT_MAX } from '$lib/server/kioskStok';
import { bolehHitungFisikDiRak, tambahKeRakDanHitung, TAMBAH_HITUNG_FISIK_MAX } from '$lib/server/kioskHitungFisik';

function parseQty(raw: unknown, label: string): number | null {
	if (raw === null || raw === undefined || raw === '') return null;
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 0) throw error(400, `${label} wajib angka 0 atau lebih.`);
	return n;
}

export const POST: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	await requireKioskMenu(session.karyawanId, 'gudang_stok', 'Cek Stok & Kelola Rak');
	const gudangId = Number(event.params.gudangId);
	if (!Number.isFinite(gudangId) || gudangId <= 0) throw error(400, 'ID rak tidak valid.');

	const body = await event.request.json().catch(() => null);
	if (!body) throw error(400, 'Body tidak valid.');
	// Body: { items: [{ item_id, expected_qty?, hitung_fisik? }, ...], client_batch_id? }
	// — atau bentuk lama { item_id, expected_qty? }.
	const rawItems: any[] = Array.isArray(body.items) ? body.items : [body];
	if (rawItems.length > TAMBAH_PLACEMENT_MAX) throw error(400, `Maksimal ${TAMBAH_PLACEMENT_MAX} barang sekali tambah.`);
	const items = rawItems.map((r) => {
		const item_id = Number(r?.item_id);
		if (!Number.isFinite(item_id) || item_id <= 0) throw error(400, 'Barang tidak valid.');
		return {
			item_id,
			expected_qty: parseQty(r?.expected_qty, 'Rencana qty'),
			hitung_fisik: parseQty(r?.hitung_fisik, 'Hitung fisik')
		};
	});

	// Dedup (baris terakhir menang — sama dengan tambahPlacement).
	const fisikById = new Map<number, number | null>();
	for (const it of items) fisikById.set(it.item_id, it.hitung_fisik);
	const jumlahFisik = [...fisikById.values()].filter((v) => v != null).length;

	if (jumlahFisik > TAMBAH_HITUNG_FISIK_MAX) {
		throw error(400, `Maksimal ${TAMBAH_HITUNG_FISIK_MAX} barang dengan hitung fisik sekali simpan. Simpan dulu, lalu lanjut.`);
	}
	if (jumlahFisik > 0) {
		let boleh: boolean;
		try {
			boleh = await bolehHitungFisikDiRak(gudangId, session.karyawanId);
		} catch (e) {
			console.error('[api/kiosk/stok/placement] gagal cek izin hitung fisik', e);
			throw error(503, 'Gagal memeriksa hak akses. Coba lagi.');
		}
		if (!boleh) {
			throw error(
				403,
				'Hitung fisik hanya untuk PIC rak atau karyawan dengan akses menu Hitung Stok. Kosongkan kolom Hitung Fisik untuk menambahkan barang saja.'
			);
		}
	}

	let result;
	try {
		result = await tambahKeRakDanHitung({
			gudang_id: gudangId,
			items,
			actor: { karyawan_id: session.karyawanId, karyawan_nama: session.nama },
			batch_id: String(body.client_batch_id || '').trim().slice(0, 80) || randomUUID()
		});
	} catch (e) {
		console.error('[api/kiosk/stok/placement] tambah gagal', e);
		throw error(502, 'Gagal menyimpan ke server. Coba lagi.');
	}
	if (!result.ok) throw error(result.status, result.error);
	return json(result);
};
