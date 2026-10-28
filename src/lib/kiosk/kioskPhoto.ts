// src/lib/kiosk/kioskPhoto.ts
// File 08 §2.1 — semua input foto kiosk (QC, FG, gerbang SJ, muat SJ) mengirim file kamera
// APA ADANYA (2-5 MB). QC dengan 8 parameter berarti satu request 16-40 MB, ditolak 413 oleh
// BODY_SIZE_LIMIT default adapter-node (512 KB) sebelum env dinaikkan (file 10), dan tetap
// lambat/timeout di jaringan pabrik walau limitnya sudah dinaikkan. `compressPhoto` sudah ada
// (dipakai ESS/stock lapangan) tapi belum dipakai kiosk — bungkus tipis ini menambah batas
// akhir yang lebih ketat untuk kiosk (foto bukti alat ukur tidak butuh resolusi penuh).

import { compressPhoto } from '$lib/utils/photoCompress';

const MAKS_UKURAN_SETELAH_KOMPRESI = 2 * 1024 * 1024; // 2 MB

/** Kompres foto kiosk. Target ~300-800KB agar QC multi-parameter tetap di bawah limit body. */
export async function prepareKioskPhoto(file: File): Promise<File> {
	const out = await compressPhoto(file);
	// compressPhoto mengembalikan file asli bila gagal — tolak kalau masih terlalu besar,
	// supaya operator tahu harus mengambil ulang foto, bukan mengirim 5 MB mentah.
	if (out.size > MAKS_UKURAN_SETELAH_KOMPRESI) {
		throw new Error('Foto terlalu besar dan gagal diperkecil. Ambil ulang foto dari jarak lebih dekat.');
	}
	return out;
}
