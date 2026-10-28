// src/lib/services/pengajuanKatalogApi.ts
// R10 (Audit Konfigurabilitas Lifecycle, 16 Sep 2026) — Field Dashboard Config Panel.
// master_pengajuan_katalog SUDAH sepenuhnya Directus-driven (aktif/urutan/permission_key
// dst — lihat routes/api/pusat-pengajuan/+server.ts), tapi belum ada UI mana pun (admin
// erp-epi maupun lapangan) untuk mengeditnya — satu-satunya cara sebelumnya adalah Directus
// Studio langsung. Modul ini + halaman /pusat-pengajuan/atur-tampilan memberi supervisor
// lapangan kendali visibilitas & urutan kartu TANPA perlu akses admin ERP.
//
// Sengaja HANYA aktif + urutan yang bisa diubah di sini (bukan label/ikon/rute/permission_key)
// — field-field itu menyangkut wiring teknis (rute form, gate profile, dst) yang salah
// ketik bisa mematahkan alur submit. "Tampilan" = visibilitas & urutan saja.

import { secureDirectusFetch } from './secureDirectus';

export interface KatalogRow {
	id: number;
	jenis_pengajuan: string;
	label: string;
	ikon: string;
	kategori: string;
	deskripsi_singkat: string | null;
	permission_key: string | null;
	aktif: boolean;
	urutan: number;
	warna_kartu: string;
	tersedia_di: string | null;
}

/** Semua kartu yang relevan untuk app lapangan (tersedia_di = 'field' atau 'keduanya' atau kosong/legacy). */
export async function fetchFieldKatalog(): Promise<KatalogRow[]> {
	const res = await secureDirectusFetch(
		'/items/master_pengajuan_katalog?sort=kategori,urutan&limit=-1' +
			'&fields=id,jenis_pengajuan,label,ikon,kategori,deskripsi_singkat,permission_key,aktif,urutan,warna_kartu,tersedia_di'
	);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const body = await res.json();
	const rows = (body.data || []) as KatalogRow[];
	return rows.filter((r) => !r.tersedia_di || r.tersedia_di === 'field' || r.tersedia_di === 'keduanya');
}

export async function setKatalogAktif(id: number, aktif: boolean): Promise<void> {
	const res = await secureDirectusFetch(`/items/master_pengajuan_katalog/${id}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ aktif })
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** Simpan urutan baru sekaligus untuk satu kategori (dipanggil setelah pindah naik/turun). */
export async function saveKatalogUrutan(rows: { id: number; urutan: number }[]): Promise<void> {
	await Promise.all(
		rows.map((r) =>
			secureDirectusFetch(`/items/master_pengajuan_katalog/${r.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ urutan: r.urutan })
			}).then((res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status} (id ${r.id})`);
			})
		)
	);
}
