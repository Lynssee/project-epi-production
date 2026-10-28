// src/lib/utils/stokKiosk.ts
// WSK-16 — aturan kecil bersama untuk stok kiosk (murni, tanpa $env) supaya bisa dipakai server & diuji.

/** Pembulatan tunggal untuk semua tulis/baca saldo: 4 desimal, buang noise float (3.499999999999999 → 3.5). */
export const round4 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 1e4) / 1e4;

/** Saldo belum pernah dicatat (null) ≠ 0: potong bahan ditolak dengan arahan ke admin, bukan "tidak cukup, tersedia 0". */
export const STOK_BELUM_TERCATAT_MSG = (nama: string) =>
	`Stok "${nama}" belum tercatat. Minta admin melakukan stok awal (stock opname) sebelum barang ini bisa dipotong lewat kiosk.`;
