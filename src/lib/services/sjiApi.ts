// src/lib/services/sjiApi.ts
// Service tipis Fase 1 Surat Jalan Internal — hanya untuk lapangan.
// Semua panggilan lewat endpoint /api/sji/* milik project-epi sendiri (bukan langsung ke
// Directus), dengan Authorization: Bearer <Firebase ID token>, supaya identitas pemohon
// selalu di-resolve server-side (lihat src/routes/api/sji/+server.ts).

import { getIdToken } from './secureDirectus';

async function authedFetch(path: string, options: RequestInit = {}): Promise<Response> {
	const token = await getIdToken();
	const { headers = {}, ...rest } = options;
	return fetch(path, {
		...rest,
		headers: { ...headers, Authorization: `Bearer ${token}` }
	});
}

async function asJson<T>(res: Response): Promise<T> {
	const data = await res.json().catch(() => null);
	if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
	return data as T;
}

export interface SjiMeta {
	settings: Record<string, any>;
	gudang: { id: number; kode_gudang: string; nama_gudang: string; jenis: string; kategori: 'gudang' | 'proyek' }[];
}

export async function fetchSjiMeta(): Promise<SjiMeta> {
	const res = await authedFetch('/api/sji?meta=1');
	return asJson<SjiMeta>(res);
}

export interface SjiListItem {
	id: number;
	reference_no: string;
	status: string;
	urgency: string;
	keperluan: string | null;
	gudang_id: { nama_gudang: string } | null;
	date_created: string;
	item_count: number;
}

export interface SjiSearchItem {
	id: number;
	nama_barang_lengkap: string;
	satuan: string | null;
	stok_tersedia: string;
	is_borrowable: boolean | null;
	consumable: boolean | null;
}

export async function searchSjiItems(query: string): Promise<SjiSearchItem[]> {
	if (query.trim().length < 2) return [];
	const res = await authedFetch(`/api/sji?search=${encodeURIComponent(query)}`);
	const data = await asJson<{ data: SjiSearchItem[] }>(res);
	return data.data;
}

export async function fetchMySji(): Promise<SjiListItem[]> {
	const res = await authedFetch('/api/sji');
	const data = await asJson<{ data: SjiListItem[] }>(res);
	return data.data;
}

export interface SjiCreateItem {
	itemId: number;
	quantity: number;
	tipe: 'ambil_pakai' | 'pinjam';
	ukuran?: string;
	lokasiPekerjaan?: string;
	tanggalJatuhTempo?: string;
}

export async function createSji(payload: {
	gudangId: number;
	urgency: 'normal' | 'urgent';
	keperluan: string;
	items: SjiCreateItem[];
}): Promise<{ success: true; id: number; reference_no: string }> {
	const res = await authedFetch('/api/sji', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	});
	return asJson(res);
}

export interface SjiDokumen {
	available: boolean;
	status?: string;
	reference_no: string;
	urgency?: string;
	keperluan?: string | null;
	gudang?: string;
	approver?: string | null;
	tanggal_approval?: string | null;
	items?: { id: number; item_id: { nama_barang_lengkap: string } | null; quantity: number; status: string; tipe: 'ambil_pakai' | 'pinjam' }[];
	qrPayload?: string;
}

/** e-Surat Jalan milik pemohon sendiri — tiap panggil menerbitkan token QR baru (rotate). */
export async function fetchSjiDokumen(id: number): Promise<SjiDokumen> {
	const res = await authedFetch(`/api/sji/${id}/dokumen`);
	return asJson<SjiDokumen>(res);
}

export async function fetchSjiDetail(id: number) {
	const res = await authedFetch(`/api/sji/${id}`);
	return asJson<{ header: any; items: any[] }>(res);
}

export interface SerahkanPayload {
	token?: string;
	items: { collection: 'pengeluaran_barang' | 'peminjaman_internal'; id: number; qtyAktual?: number }[];
	mode?: 'petugas' | 'mandiri';
	foto?: File | null;
	ttd?: File | null;
	/** Wajib diisi per item (key: `${collection}_${id}`) saat mode 'mandiri' — lihat konfirmasi/+page.svelte */
	fotoPerItem?: Record<string, File>;
	saksiKaryawanId?: number;
	saksiKontak?: string;
	saksiTtd?: File | null;
	lat?: number | null;
	lng?: number | null;
	clientTxnId?: string;
}

export interface SerahkanItem {
	id: number;
	item_id: { nama_barang_lengkap: string } | null;
	quantity: number;
	ukuran?: string | null;
	tanggal_jatuh_tempo?: string | null;
	tipe: 'ambil_pakai' | 'pinjam';
	collection: 'pengeluaran_barang' | 'peminjaman_internal';
}

export async function fetchSjiForServah(id: number, token: string) {
	const res = await authedFetch(`/api/sji/${id}/serahkan?token=${encodeURIComponent(token)}`);
	return asJson<{ header: any; items: SerahkanItem[] }>(res);
}

export async function serahkanSji(id: number, payload: SerahkanPayload) {
	const form = new FormData();
	if (payload.token) form.append('token', payload.token);
	form.append('items', JSON.stringify(payload.items));
	if (payload.mode) form.append('mode', payload.mode);
	if (payload.foto) form.append('foto', payload.foto);
	if (payload.ttd) form.append('ttd', payload.ttd);
	if (payload.fotoPerItem) {
		for (const [key, file] of Object.entries(payload.fotoPerItem)) {
			form.append(`fotoItem_${key}`, file);
		}
	}
	if (payload.saksiKaryawanId != null) form.append('saksiKaryawanId', String(payload.saksiKaryawanId));
	if (payload.saksiKontak) form.append('saksiKontak', payload.saksiKontak);
	if (payload.saksiTtd) form.append('saksiTtd', payload.saksiTtd);
	if (payload.lat != null) form.append('lat', String(payload.lat));
	if (payload.lng != null) form.append('lng', String(payload.lng));
	if (payload.clientTxnId) form.append('clientTxnId', payload.clientTxnId);

	const res = await authedFetch(`/api/sji/${id}/serahkan`, { method: 'POST', body: form });
	return asJson<{ success: true; results: any[]; partial: boolean }>(res);
}

export interface KembalikanPayload {
	kondisi_kembali: 'baik' | 'rusak' | 'hilang';
	catatan_pengecekan?: string;
	foto?: File | null;
	lat?: number | null;
	lng?: number | null;
}

export async function kembalikanPeminjaman(itemId: number, payload: KembalikanPayload) {
	const form = new FormData();
	form.append('kondisi_kembali', payload.kondisi_kembali);
	if (payload.catatan_pengecekan) form.append('catatan_pengecekan', payload.catatan_pengecekan);
	if (payload.foto) form.append('foto', payload.foto);
	if (payload.lat != null) form.append('lat', String(payload.lat));
	if (payload.lng != null) form.append('lng', String(payload.lng));

	const res = await authedFetch(`/api/sji/peminjaman/${itemId}/kembali`, { method: 'POST', body: form });
	return asJson<{ success: true; data: any }>(res);
}

export async function cancelSji(id: number): Promise<{ success: true }> {
	const res = await authedFetch(`/api/sji/${id}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'cancel' })
	});
	return asJson(res);
}
