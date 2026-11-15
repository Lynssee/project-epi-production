// src/routes/api/kiosk/stok/rak/[gudangId]/barang-baru/+server.ts
// Daftarkan barang yang ditemukan di rak tetapi belum ada di identitas_barang, langsung
// tempatkan di rak ini, dan (bila diisi) catat hitung fisiknya ke stok.
//
// Urutan sengaja "periksa semua dulu, baru tulis" supaya penolakan tidak meninggalkan barang
// yatim: rak valid → izin hitung fisik → nama belum terdaftar → buat barang → tempatkan + hitung.
// Barang baru bertanda perlu_verifikasi_pendaftaran=true & kategori kosong; admin melengkapinya
// di dashboard internal (lihat kioskBarangBaru.ts).
//
// GET mengembalikan pilihan satuan (diatur admin lewat system_settings).

import { randomUUID } from 'node:crypto';
import { json, error, type RequestHandler } from '@sveltejs/kit';
import { directusServerJson } from '$lib/server/directus';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { requireKioskMenu } from '$lib/server/kioskMenuAccess';
import { bolehAdjustRak } from '$lib/server/kioskGudang';
import { tambahKeRakDanHitung } from '$lib/server/kioskHitungFisik';
import { buatBarangBaru, cariBarangSamaNama, rakitNamaBarang, readSatuanBarangBaru, normalNama } from '$lib/server/kioskBarangBaru';

export const GET: RequestHandler = async (event) => {
	requireKioskSession(event);
	return json({ satuan: await readSatuanBarangBaru() });
};

function teks(raw: unknown, label: string, min: number, max: number): string {
	const v = String(raw ?? '').replace(/\s+/g, ' ').trim();
	if (v.length < min) throw error(400, `${label} wajib diisi${min > 1 ? ` (minimal ${min} huruf)` : ''}.`);
	if (v.length > max) throw error(400, `${label} terlalu panjang (maksimal ${max} huruf).`);
	return v;
}

export const POST: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	await requireKioskMenu(session.karyawanId, 'gudang_stok', 'Cek Stok & Kelola Rak');
	const gudangId = Number(event.params.gudangId);
	if (!Number.isFinite(gudangId) || gudangId <= 0) throw error(400, 'ID rak tidak valid.');

	const body = await event.request.json().catch(() => null);
	if (!body) throw error(400, 'Body tidak valid.');
	const namaProduk = teks(body.nama_produk, 'Nama produk', 2, 100);
	const warna = teks(body.warna, 'Warna', 1, 60);
	const satuan = normalNama(teks(body.satuan, 'Satuan', 1, 20));
	const rawFisik = body.hitung_fisik;
	let hitungFisik: number | null = null;
	if (rawFisik !== null && rawFisik !== undefined && rawFisik !== '') {
		hitungFisik = Number(rawFisik);
		if (!Number.isFinite(hitungFisik) || hitungFisik < 0) throw error(400, 'Hitung fisik wajib angka 0 atau lebih.');
	}

	// 1. Rak valid + izin (satu baca gudang dipakai untuk keduanya).
	let rak: any;
	let satuanValid: string[];
	try {
		const [rakRes, daftarSatuan] = await Promise.all([
			directusServerJson<{ data: any }>(`/items/gudang/${gudangId}?fields=id,nama_gudang,parent_gudang_id,pic_karyawan_ids`),
			readSatuanBarangBaru()
		]);
		rak = rakRes?.data;
		satuanValid = daftarSatuan;
	} catch (e) {
		console.error('[api/kiosk/stok/barang-baru] gagal baca rak', e);
		throw error(503, 'Gagal membaca data rak. Coba lagi.');
	}
	if (!rak) throw error(404, 'Rak tidak ditemukan.');
	if (!rak.parent_gudang_id) throw error(400, 'Barang hanya bisa ditempatkan di rak/zona, bukan gudang level teratas.');
	if (!satuanValid.includes(satuan)) throw error(400, `Satuan harus salah satu dari: ${satuanValid.join(', ')}.`);

	if (hitungFisik != null) {
		let boleh: boolean;
		try {
			boleh = await bolehAdjustRak(session.karyawanId, rak);
		} catch (e) {
			console.error('[api/kiosk/stok/barang-baru] gagal cek izin', e);
			throw error(503, 'Gagal memeriksa hak akses. Coba lagi.');
		}
		if (!boleh) {
			throw error(403, 'Hitung fisik hanya untuk PIC rak atau karyawan dengan akses menu Hitung Stok. Kosongkan Hitung Fisik untuk mendaftarkan barang saja.');
		}
	}

	// 2. Tolak duplikat — arahkan operator memakai barang yang sudah ada (bukan membuat dobel).
	const nama = rakitNamaBarang(namaProduk, warna);
	let dup;
	try {
		dup = await cariBarangSamaNama(nama);
	} catch (e) {
		console.error('[api/kiosk/stok/barang-baru] gagal cek duplikat', e);
		throw error(503, 'Gagal memeriksa data barang. Coba lagi.');
	}
	if (dup) {
		return json(
			{
				message: `"${dup.nama_barang_lengkap}" sudah terdaftar. Pakai barang yang sudah ada.`,
				existing: { identitas_barang_id: dup.id, nama_barang: dup.nama_barang_lengkap, satuan: dup.satuan }
			},
			{ status: 409 }
		);
	}

	// 3. Buat barang (stok 0, perlu verifikasi, tanpa kategori).
	let barang;
	try {
		barang = await buatBarangBaru({
			nama_produk: namaProduk,
			warna,
			satuan,
			rak_nama: rak.nama_gudang,
			karyawan_id: session.karyawanId,
			karyawan_nama: session.nama
		});
	} catch (e) {
		console.error('[api/kiosk/stok/barang-baru] gagal membuat barang', e);
		throw error(502, 'Gagal mendaftarkan barang. Coba lagi.');
	}

	// Audit pendaftaran (penempatan diaudit sendiri oleh tambahPlacement). Non-fatal.
	await directusServerJson('/items/scan_log', {
		method: 'POST',
		body: JSON.stringify({
			ref_collection: 'identitas_barang',
			ref_id: String(barang.id),
			actor_id: session.karyawanId,
			actor_role: 'kiosk_gudang',
			timestamp: new Date().toISOString(),
			source: 'kiosk',
			stage_from: null,
			stage_to: 'perlu_verifikasi_pendaftaran',
			notes: `[KELOLA-RAK:DAFTAR-BARU] ${barang.nama_barang_lengkap} (${barang.satuan}) didaftarkan di ${rak.nama_gudang} — oleh ${session.nama} (#${session.karyawanId})`
		})
	}).catch((e) => console.warn('[api/kiosk/stok/barang-baru] audit gagal (non-fatal)', e));

	// 4. Tempatkan + hitung fisik lewat jalur yang sama dengan Tambah Item ke Rak.
	const barangOut = { identitas_barang_id: barang.id, nama_barang: barang.nama_barang_lengkap, satuan: barang.satuan };
	try {
		const hasil = await tambahKeRakDanHitung({
			gudang_id: gudangId,
			items: [{ item_id: barang.id, expected_qty: null, hitung_fisik: hitungFisik }],
			actor: { karyawan_id: session.karyawanId, karyawan_nama: session.nama },
			batch_id: String(body.client_batch_id || '').trim().slice(0, 80) || randomUUID(),
			catatan: 'Hitung fisik barang baru (didaftarkan dari kiosk)'
		});
		if (!hasil.ok) throw new Error(hasil.error);
		return json({ ...hasil, barang: barangOut });
	} catch (e) {
		// Barang SUDAH terdaftar — beri tahu jelas supaya operator tidak mendaftarkan ulang.
		console.error('[api/kiosk/stok/barang-baru] barang terdaftar tapi gagal ditempatkan', barang.id, e);
		return json(
			{
				message: `"${barang.nama_barang_lengkap}" sudah terdaftar, tetapi gagal ditempatkan ke rak. Cari barang itu lalu tambahkan lagi.`,
				barang: barangOut
			},
			{ status: 502 }
		);
	}
};
