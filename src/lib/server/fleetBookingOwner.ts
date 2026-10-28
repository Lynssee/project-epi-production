// src/lib/server/fleetBookingOwner.ts
// Peminjaman 12 §1 — kepemilikan booking berdasarkan `karyawan_id`, BUKAN nama. Dulu pemeriksaan pemilik memakai
// `requester_name === karyawan.nama_karyawan` ATAU `karyawan_id`: dua karyawan bernama sama bisa melihat, membatalkan, dan
// mem-P2H booking orang lain (P2H mengaktifkan/menutup booking). Fallback nama HANYA untuk membaca baris lama yang belum
// ter-backfill (`karyawan_id` kosong) — aksi TULIS wajib `karyawan_id`.

export type OwnerKaryawan = { id: number | string; nama_karyawan: string };

/** Pemilik sah (untuk aksi TULIS: batal, P2H, setor balik, dispensasi). */
export function isBookingOwner(booking: any, karyawan: OwnerKaryawan): boolean {
	if (booking?.karyawan_id !== null && booking?.karyawan_id !== undefined && String(booking.karyawan_id) !== '') {
		return String(booking.karyawan_id) === String(karyawan.id);
	}
	return false;
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** Pemilik untuk aksi BACA (daftar, detail): boleh fallback nama untuk baris lama tanpa `karyawan_id`. */
export function isBookingOwnerForRead(booking: any, karyawan: OwnerKaryawan): boolean {
	if (isBookingOwner(booking, karyawan)) return true;
	const tanpaId = booking?.karyawan_id === null || booking?.karyawan_id === undefined || String(booking?.karyawan_id) === '';
	return tanpaId && !!norm(booking?.requester_name) && norm(booking.requester_name) === norm(karyawan.nama_karyawan);
}

/** Pesan penolakan ramah (ada jalan keluar: hubungi GA). */
export const PESAN_BUKAN_PEMILIK = 'Pengajuan ini tercatat atas nama orang lain. Hubungi GA bila ini keliru.';
export const PESAN_BELUM_TERTAUT = 'Pengajuan lama ini belum tertaut ke akun Anda sehingga tidak bisa diubah dari aplikasi. Hubungi GA agar ditautkan.';

/** Pesan yang tepat untuk penolakan aksi tulis (baris lama tanpa karyawan_id vs milik orang lain). */
export function pesanTolakTulis(booking: any): string {
	const tanpaId = booking?.karyawan_id === null || booking?.karyawan_id === undefined || String(booking?.karyawan_id) === '';
	return tanpaId ? PESAN_BELUM_TERTAUT : PESAN_BUKAN_PEMILIK;
}

/** Filter Directus (JSON) untuk daftar riwayat: milik sendiri lewat id + baris lama tanpa id yang namanya sama. */
export function filterRiwayatMilik(karyawan: OwnerKaryawan): Record<string, unknown> {
	return {
		_or: [
			{ karyawan_id: { _eq: String(karyawan.id) } },
			{ _and: [{ karyawan_id: { _null: true } }, { requester_name: { _eq: karyawan.nama_karyawan } }] }
		]
	};
}
