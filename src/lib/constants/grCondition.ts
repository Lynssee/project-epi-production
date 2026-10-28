// src/lib/constants/grCondition.ts
//
// Satu-satunya definisi kondisi barang pada Goods Received. Sebelumnya tipe ini ditulis
// ulang di 5 tempat dengan isi 'ok' | 'rusak' | 'hilang' — tidak cocok dengan <option>
// yang benar-benar tampil di stock-lapangan/masuk ('ok' | 'kurang' | 'rusak'). Akibatnya
// 'hilang' tidak pernah bisa dipilih user, sementara 'kurang' yang bisa dipilih justru
// di luar tipe. Modul ini hanya berisi tipe + konstanta (tanpa runtime import), jadi aman
// dipakai bersama oleh kode klien maupun endpoint server.

/**
 * Nilai yang BISA DIKIRIM KLIEN. Persis opsi <select> di halaman Barang Masuk.
 *
 * Catatan penting soal 'hilang': klien tidak pernah mengirimnya. Server-lah yang
 * menyimpulkan 'hilang' dari qty diterima = 0 (lihat routes/api/goods-received/confirm),
 * jadi 'hilang' bukan pilihan user melainkan hasil turunan.
 */
export type GRCondition = 'ok' | 'kurang' | 'rusak';

/**
 * Nilai yang DISIMPAN SERVER ke `surat_jalan_items.gr_condition`. Berbeda dari
 * GRCondition: server memetakan 'kurang' menjadi 'ok' atau 'hilang' berdasarkan qty.
 */
export type GRConditionTersimpan = 'ok' | 'rusak' | 'hilang';

/** Opsi untuk <select> kondisi barang — dipakai agar label dan nilai tidak lagi ditulis manual. */
export const GR_CONDITION_OPTIONS: { value: GRCondition; label: string }[] = [
	{ value: 'ok', label: 'Sesuai' },
	{ value: 'kurang', label: 'Kurang' },
	{ value: 'rusak', label: 'Rusak' }
];
