// src/lib/server/kioskBarangBaru.ts
// Daftarkan barang baru dari Kiosk Cek Stok — untuk barang yang ditemukan saat hitung fisik di rak
// tetapi belum ada di identitas_barang.
//
// Pola sama dengan "Pendaftaran Barang Cepat" (api/inventory/daftar-barang-cepat, kedua app):
// baris dibuat perlu_verifikasi_pendaftaran=true, TANPA kode_item & TANPA kategori. Stok langsung
// tercatat lewat jalur hitung fisik biasa; kategori dilengkapi admin di dashboard internal
// (Inventory → Verifikasi Pendaftaran, erp-epi-1 PendaftaranVerifikasiCuration) — modul itu
// MENOLAK verifikasi selama kategori kosong, jadi barang tidak bisa "lolos" tanpa kategori.
//
// Kiosk TIDAK membuat master product_name / warna_fg baru. Bila teks cocok persis dengan master,
// id-nya ikut diisi; bila tidak, pencocokan dilakukan admin saat verifikasi.

import { directusServerJson } from '$lib/server/directus';

const SATUAN_DEFAULT = ['KG', 'LITER', 'PCS', 'UNIT'];

/** Pilihan satuan di form — bisa diatur admin lewat system_settings `kiosk.stok.satuan_barang_baru`. */
export async function readSatuanBarangBaru(): Promise<string[]> {
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/system_settings?filter[setting_key][_eq]=kiosk.stok.satuan_barang_baru&fields=setting_value&limit=1`
		);
		const raw = res?.data?.[0]?.setting_value;
		const parsed = raw ? JSON.parse(raw) : null;
		if (Array.isArray(parsed)) {
			const list = [...new Set(parsed.map((v) => String(v).trim().toUpperCase()).filter(Boolean))];
			if (list.length) return list;
		}
	} catch {
		/* pakai default */
	}
	return SATUAN_DEFAULT;
}

/** Huruf besar + spasi dirapikan — konsisten dengan nama_barang_lengkap yang sudah ada. */
export function normalNama(s: string): string {
	return String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

export function rakitNamaBarang(produk: string, warna: string): string {
	return normalNama(`${produk} ${warna}`);
}

/** Cari barang master dengan nama sama persis (abaikan huruf besar/kecil & spasi ganda). */
export async function cariBarangSamaNama(nama: string): Promise<{ id: number; nama_barang_lengkap: string; satuan: string | null } | null> {
	const target = normalNama(nama);
	const res = await directusServerJson<{ data: any[] }>(
		`/items/identitas_barang?filter[nama_barang_lengkap][_icontains]=${encodeURIComponent(target)}` +
			`&fields=id,nama_barang_lengkap,satuan&limit=20`
	);
	const hit = (res?.data || []).find((r) => normalNama(r.nama_barang_lengkap) === target);
	return hit ? { id: Number(hit.id), nama_barang_lengkap: hit.nama_barang_lengkap, satuan: hit.satuan || null } : null;
}

const MASTER = {
	produk: { koleksi: 'product_name', kolom: 'product_name' },
	warna: { koleksi: 'warna_fg', kolom: 'nama_warna' }
} as const;
export type JenisMaster = keyof typeof MASTER;

/** Saran autocomplete dari master product_name / warna_fg. */
export async function cariMaster(jenis: JenisMaster, q: string, limit = 8): Promise<{ id: number; nama: string }[]> {
	const term = String(q || '').trim();
	if (term.length < 2) return [];
	const { koleksi, kolom } = MASTER[jenis];
	const res = await directusServerJson<{ data: any[] }>(
		`/items/${koleksi}?filter[${kolom}][_icontains]=${encodeURIComponent(term)}&fields=id,${kolom}&sort=${kolom}&limit=${limit}`
	);
	return (res?.data || [])
		.filter((r) => r?.[kolom])
		.map((r) => ({ id: Number(r.id), nama: String(r[kolom]).trim() }));
}

async function idMasterPersis(jenis: JenisMaster, teks: string): Promise<number | null> {
	const target = normalNama(teks);
	if (!target) return null;
	try {
		const rows = await cariMaster(jenis, teks, 20);
		return rows.find((r) => normalNama(r.nama) === target)?.id ?? null;
	} catch {
		return null; // tidak fatal — admin mencocokkan saat verifikasi
	}
}

export interface DaftarBarangBaruInput {
	nama_produk: string;
	warna: string;
	satuan: string;
	rak_nama: string;
	karyawan_id: number;
	karyawan_nama: string;
}

/** Buat baris identitas_barang (belum ditempatkan, stok 0). Duplikat WAJIB sudah dicek pemanggil. */
export async function buatBarangBaru(input: DaftarBarangBaruInput): Promise<{ id: number; nama_barang_lengkap: string; satuan: string }> {
	const nama = rakitNamaBarang(input.nama_produk, input.warna);
	const satuan = normalNama(input.satuan);
	const [productNameId, warnaId] = await Promise.all([idMasterPersis('produk', input.nama_produk), idMasterPersis('warna', input.warna)]);
	const tanggal = new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium' });
	const created = await directusServerJson<{ data: any }>('/items/identitas_barang', {
		method: 'POST',
		body: JSON.stringify({
			nama_barang_lengkap: nama,
			satuan,
			product_name_id: productNameId,
			warna_fg_id: warnaId,
			parent_category: null,
			perlu_verifikasi_pendaftaran: true,
			stok_tersedia: 0,
			stok_total: 0,
			deskripsi:
				`Didaftarkan dari Kiosk Cek Stok (${input.rak_nama}) oleh ${input.karyawan_nama} (#${input.karyawan_id}) pada ${tanggal}. ` +
				`Produk: ${normalNama(input.nama_produk)} · Warna: ${normalNama(input.warna)}. Kategori belum diisi — lengkapi di Verifikasi Pendaftaran.`
		})
	});
	const row = created?.data;
	if (!row?.id) throw new Error('Directus tidak mengembalikan id barang baru.');
	return { id: Number(row.id), nama_barang_lengkap: row.nama_barang_lengkap || nama, satuan };
}
