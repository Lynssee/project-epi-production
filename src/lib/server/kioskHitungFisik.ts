// src/lib/server/kioskHitungFisik.ts
// Satu jalur pencatatan "hitung fisik satu barang di satu rak", dipakai oleh:
//   - POST /api/kiosk/stok/rak/[gudangId]/placement/[placementId]/adjust  (tombol Input Hitung Fisik)
//   - POST /api/kiosk/stok/rak/[gudangId]/placement                       (Tambah Item ke Rak + hitung fisik)
//   - POST /api/kiosk/stok/rak/[gudangId]/barang-baru                     (Daftarkan barang baru + hitung fisik)
// Urutan SAMA PERSIS dengan endpoint adjust sebelum direfaktor: bila (rak, barang) ada di sesi
// opname `counting`, hitungan masuk sesi (stok berubah setelah review admin); selain itu langsung
// adjustment via adjustOpnameRak (rumus alokasi & selisih tidak diubah).

import { directusServerJson } from '$lib/server/directus';
import { adjustOpnameRak, bolehAdjustRak, type AdjustRakHasil } from '$lib/server/kioskGudang';
import { masukkanKeSesiAktif } from '$lib/server/opnameSesi';
import { tambahPlacement, type KelolaRakActor } from '$lib/server/kioskStok';

export type HitungFisikRakHasil =
	| { ok: true; status: 'masuk_sesi'; reference_no: string }
	| AdjustRakHasil
	| { ok: false; error: string; status: number };

export async function catatHitungFisikRak(input: {
	gudang_id: number;
	placement_id: number;
	item_id: number;
	hitung_fisik: number;
	catatan: string;
	client_txn_id: string;
	karyawan_id: number;
	karyawan_nama: string;
}): Promise<HitungFisikRakHasil> {
	const masukSesi = await masukkanKeSesiAktif({
		itemId: input.item_id,
		rakId: input.gudang_id,
		hitungFisik: input.hitung_fisik,
		karyawanNama: input.karyawan_nama
	}).catch((e) => {
		console.warn('[kioskHitungFisik] cek sesi opname gagal, pakai jalur langsung:', e);
		return null;
	});
	if (masukSesi) return { ok: true, status: 'masuk_sesi', reference_no: masukSesi.kode };

	return adjustOpnameRak({
		gudang_id: input.gudang_id,
		placement_id: input.placement_id,
		hitung_fisik: input.hitung_fisik,
		catatan: input.catatan,
		client_txn_id: input.client_txn_id,
		karyawan_id: input.karyawan_id,
		karyawan_nama: input.karyawan_nama
	});
}

/** Tiap hitung fisik = ±7 call Directus (adjustment), diproses berurutan — dibatasi supaya satu
 *  simpan "Tambah Item ke Rak" tidak menahan operator terlalu lama. Barang TANPA hitung fisik
 *  tetap boleh sampai TAMBAH_PLACEMENT_MAX. */
export const TAMBAH_HITUNG_FISIK_MAX = 20;

/** Hasil hitung fisik per barang pada respons Tambah Item ke Rak. */
export interface HitungFisikBaris {
	item_id: number;
	nama: string;
	ok: boolean;
	/** 'auto_approved' | 'no_change' | 'menunggu_approval' | 'masuk_sesi' saat ok. */
	status?: string;
	reference_no?: string | null;
	di_rak_baru?: number;
	error?: string;
}

/**
 * Hak hitung fisik di rak = aturan adjustment yang sudah ada (PIC rak / rak induk, atau centang
 * menu Hitung Stok). Melempar bila data izin gagal dibaca — pemanggil membalas 503.
 */
export async function bolehHitungFisikDiRak(gudangId: number, karyawanId: number): Promise<boolean> {
	const rak = await directusServerJson<{ data: any }>(`/items/gudang/${gudangId}?fields=parent_gudang_id,pic_karyawan_ids`);
	return bolehAdjustRak(karyawanId, rak.data);
}

/**
 * Tempatkan barang ke rak, lalu catat hitung fisik untuk barang yang BENAR-BENAR baru ditempatkan.
 * Izin hitung fisik WAJIB sudah dicek pemanggil (sebelum ada data yang ditulis).
 *
 * Barang yang dilewati ("Sudah ada di rak ini") tidak dihitung ulang — ini juga yang membuat
 * tekan-dua-kali aman: kiriman kedua melewati semua barang, jadi stok tidak tercatat ganda.
 * Satu barang gagal tidak membatalkan barang lain; penempatannya sudah tersimpan, operator tinggal
 * memakai tombol "Input Hitung Fisik" di kartu barang itu.
 */
export async function tambahKeRakDanHitung(input: {
	gudang_id: number;
	items: { item_id: number; expected_qty: number | null; hitung_fisik: number | null }[];
	actor: KelolaRakActor;
	batch_id: string;
	catatan?: string;
}) {
	const { gudang_id, actor, batch_id } = input;
	const fisikById = new Map<number, number | null>();
	for (const it of input.items) fisikById.set(it.item_id, it.hitung_fisik);

	const result = await tambahPlacement({
		gudang_id,
		items: input.items.map(({ item_id, expected_qty }) => ({ item_id, expected_qty })),
		actor
	});
	if (!result.ok) return result;

	const hitung_fisik: HitungFisikBaris[] = [];
	for (const d of result.ditambahkan) {
		const fisik = fisikById.get(d.item_id);
		if (fisik == null) continue;
		try {
			const h = await catatHitungFisikRak({
				gudang_id,
				placement_id: d.placement_id,
				item_id: d.item_id,
				hitung_fisik: fisik,
				catatan: input.catatan || 'Hitung fisik saat menambahkan barang ke rak',
				client_txn_id: `tambahrak-${gudang_id}-${batch_id}-${d.item_id}`,
				karyawan_id: actor.karyawan_id,
				karyawan_nama: actor.karyawan_nama
			});
			hitung_fisik.push(
				h.ok
					? {
							item_id: d.item_id,
							nama: d.nama,
							ok: true,
							status: h.status,
							reference_no: h.reference_no ?? null,
							di_rak_baru: 'di_rak_baru' in h ? h.di_rak_baru : fisik
						}
					: { item_id: d.item_id, nama: d.nama, ok: false, error: h.error }
			);
		} catch (e: any) {
			console.error('[kioskHitungFisik] hitung fisik gagal', d.item_id, e);
			hitung_fisik.push({
				item_id: d.item_id,
				nama: d.nama,
				ok: false,
				error: e?.body?.message || e?.message || 'Gagal mencatat hitung fisik.'
			});
		}
	}
	return { ...result, hitung_fisik };
}
