// src/lib/services/gaRuangan.ts
// Klien Halaman Ruangan (Barang per Ruangan via QR Patroli, Fase 2). Baca lewat
// endpoint agregat /api/ga-ruangan/[areaId] (1 panggilan) — server yang menyatukan
// relasi & memutuskan visibilitas nilai rupiah. READ-ONLY di fase ini.

import { getIdToken } from './secureDirectus';

export type KondisiBarang = 'baik' | 'perlu_perbaikan' | 'rusak';
export type KategoriBarang = 'perabotan' | 'elektronik' | 'peralatan' | 'lainnya';

export interface RuanganBarang {
	id: number;
	kode: string | null;
	nama: string;
	kategori: KategoriBarang | string;
	qty: number;
	qty_rusak: number;
	kondisi: KondisiBarang | string;
	mode_lacak: 'unit' | 'kolektif' | string;
	identitas_barang_id: number | null;
	last_checked_at: string | null;
	nilai: number | null;
}

export interface RuanganDetail {
	room: {
		area_id: number;
		area_name: string;
		zone_name: string | null;
		location_name: string | null;
		checkpoint_code: string | null;
	};
	assets: RuanganBarang[];
	summary: { jenis: number; total_unit: number; total_rusak: number };
	last_patrol: { waktu: string | null; oleh: string | null } | null;
	last_check: { waktu: string | null; jml_selisih: number | null } | null;
	show_nilai: boolean;
	interval_cek_hari: number;
	mode_pengingat_cek: 'off' | 'shadow' | 'soft';
}

async function apiGet<T>(url: string): Promise<T> {
	const idToken = await getIdToken();
	const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) {
		let msg = `Gagal memuat (${res.status})`;
		try {
			const j = await res.json();
			msg = j?.message || msg;
		} catch {
			/* biarkan pesan default */
		}
		throw new Error(msg);
	}
	return res.json();
}

/** Detail 1 ruangan + daftar barang. */
export function fetchRuangan(areaId: number | string): Promise<RuanganDetail> {
	return apiGet<RuanganDetail>(`/api/ga-ruangan/${areaId}`);
}

export interface RuanganRingkas {
	area_id: number;
	area_name: string;
	zone_name: string | null;
	location_name: string | null;
	jumlah_barang: number;
	perlu_dicek: boolean;
	punya_qr: boolean;
}

/** Daftar semua ruangan (dikelompokkan site -> zona di UI). */
export function fetchDaftarRuangan(): Promise<{ ruangan: RuanganRingkas[] }> {
	return apiGet<{ ruangan: RuanganRingkas[] }>(`/api/ga-ruangan`);
}

export interface CariBarangHit {
	area_id: number;
	area_name: string;
	nama: string;
	kategori: string;
	qty: number;
	kondisi: string;
}

/** B1 — "barang ini ada di ruangan mana". Query minimal 2 huruf. */
export function cariBarang(q: string): Promise<{ hasil: CariBarangHit[] }> {
	return apiGet<{ hasil: CariBarangHit[] }>(`/api/ga-ruangan/cari?q=${encodeURIComponent(q)}`);
}

// ---- Fase 3: sensus (tulis) ----------------------------------------------

export interface KatalogHit {
	id: number;
	nama: string;
	kategori: string;
}

/** Cari katalog identitas_barang (perabotan/elektronik/peralatan) untuk form sensus. */
export function cariKatalog(q: string, kategori?: string): Promise<{ hasil: KatalogHit[] }> {
	const p = new URLSearchParams();
	if (q) p.set('q', q);
	if (kategori) p.set('kategori', kategori);
	return apiGet<{ hasil: KatalogHit[] }>(`/api/ga-ruangan/katalog?${p.toString()}`);
}

async function apiSend<T>(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<T> {
	const idToken = await getIdToken();
	const res = await fetch(url, {
		method,
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!res.ok) {
		let msg = `Gagal menyimpan (${res.status})`;
		try {
			const j = await res.json();
			msg = j?.message || msg;
		} catch {
			/* default */
		}
		throw new Error(msg);
	}
	return res.json();
}

export interface TambahBarangInput {
	nama?: string;
	identitas_barang_id?: number | null;
	kategori: string;
	mode_lacak: 'unit' | 'kolektif';
	qty?: number;
	qty_rusak?: number;
	kondisi: string;
	foto?: string | null;
	catatan?: string | null;
}

/** Tambah 1 barang ke ruangan (butuh permission kelola_aset_ruangan). */
export function tambahBarang(areaId: number | string, input: TambahBarangInput): Promise<{ ok: true; asset: any }> {
	return apiSend(`/api/ga-ruangan/${areaId}/barang`, 'POST', input);
}

/** Ubah qty / qty_rusak / kondisi 1 barang. */
export function ubahBarang(
	areaId: number | string,
	patch: { asset_id: number; qty?: number; qty_rusak?: number; kondisi?: string }
): Promise<{ ok: true; asset: any }> {
	return apiSend(`/api/ga-ruangan/${areaId}/barang`, 'PATCH', patch);
}

// ---- Fase 4: cek kelengkapan & lapor selisih ------------------------------

export type StatusBarisCek = 'ada' | 'kurang' | 'rusak' | 'tidak_ada';

export interface CekRuanganInput {
	client_event_id: string;
	checkpoint_id?: number | null;
	lat?: number | null;
	lng?: number | null;
	foto?: string | null;
	catatan?: string | null;
	hasil: Array<{ asset_id: number; status: StatusBarisCek; qty_aktual?: number | null; catatan?: string | null }>;
}

/** Kirim hasil Cek Kelengkapan 1 ruangan. Idempoten lewat client_event_id. */
export function submitCekRuangan(
	areaId: number | string,
	input: CekRuanganInput
): Promise<{ ok: true; room_check: any; idempotent: boolean }> {
	return apiSend(`/api/ga-ruangan/${areaId}/cek`, 'POST', input);
}

/** Lapor 1 barang (rusak/pindah/hilang) tanpa sesi cek penuh. 'rusak' -> tiket Service Desk GA otomatis. */
export function laporBarang(input: {
	asset_id: number;
	jenis: 'rusak' | 'pindah' | 'hilang';
	qty?: number | null;
	catatan?: string | null;
	foto?: string | null;
}): Promise<{ ok: true; movement_id: number | null; ticket_id: number | null }> {
	return apiSend(`/api/ga-ruangan/lapor`, 'POST', input);
}
