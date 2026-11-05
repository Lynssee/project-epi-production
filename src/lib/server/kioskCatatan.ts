// src/lib/server/kioskCatatan.ts
// Penyimpanan Catatan Kerja kru (Rencana Kiosk Proyek, Fase 4) — koleksi `kiosk_catatan_kerja`.
// Query dipisah per relasi. Koleksi dipasang terpisah (skema = izin Lead); sebelum itu setiap akses
// gagal-lunak dengan pesan 503 yang jelas — BUKAN menelan error diam-diam: penyebab asli dicatat di log.

import { error } from '@sveltejs/kit';
import { directusServerJson } from '$lib/server/directus';
import { idOf } from '$lib/server/manpowerAbsensiCore';
import { namaManpower } from '$lib/server/kioskProyekDevice';
import type { CatatanKru, JenisCatatan } from '$lib/utils/kioskCatatan';

const KOLEKSI = 'kiosk_catatan_kerja';
const FIELDS = 'id,project_id,manpower_id,tanggal,jenis,kategori,catatan,foto,status,perangkat_id,dicatat_oleh,report_id,date_created';

/** Directus membalas 403 (bukan 404) untuk koleksi yang belum ada — perlakukan sebagai "belum disiapkan". */
function belumSiap(e: unknown): never {
	console.error(`[kioskCatatan] akses ${KOLEKSI} gagal (skema belum dipasang atau izin token kurang?):`, (e as Error)?.message);
	throw error(503, 'Fitur Catatan Kerja belum disiapkan di server. Hubungi admin.');
}

export async function jumlahCatatanHariIni(projectId: number, manpowerId: number, tanggal: string): Promise<number> {
	try {
		const q = new URLSearchParams({
			'filter[project_id][_eq]': String(projectId),
			'filter[manpower_id][_eq]': String(manpowerId),
			'filter[tanggal][_eq]': tanggal,
			'aggregate[count]': '*'
		});
		const r = await directusServerJson<{ data: any[] }>(`/items/${KOLEKSI}?${q.toString()}`);
		return Number(r?.data?.[0]?.count ?? 0) || 0;
	} catch (e) {
		return belumSiap(e);
	}
}

export async function simpanCatatan(p: {
	projectId: number;
	manpowerId: number;
	tanggal: string;
	jenis: JenisCatatan;
	kategori: string;
	catatan: string;
	fotoId: string | null;
	perangkatId: number;
	dicatatOleh: string;
}): Promise<number> {
	try {
		const r = await directusServerJson<{ data: { id: number } }>(`/items/${KOLEKSI}`, {
			method: 'POST',
			body: JSON.stringify({
				project_id: p.projectId,
				manpower_id: p.manpowerId,
				tanggal: p.tanggal,
				jenis: p.jenis,
				kategori: p.kategori,
				catatan: p.catatan,
				foto: p.fotoId,
				status: 'baru',
				perangkat_id: p.perangkatId,
				dicatat_oleh: p.dicatatOleh.slice(0, 128)
			})
		});
		return Number(r?.data?.id);
	} catch (e) {
		return belumSiap(e);
	}
}

export interface CatatanRow extends CatatanKru {
	project_id: number;
	manpower_id: number;
	tanggal: string;
	status: string;
	dicatat_oleh: string | null;
	date_created: string | null;
}

/** Catatan berstatus `baru` untuk satu proyek & tanggal, lengkap dengan nama penulis (query terpisah). */
export async function daftarCatatanBaru(projectId: number, tanggal: string): Promise<CatatanRow[]> {
	let rows: any[] = [];
	try {
		const q = new URLSearchParams({
			'filter[project_id][_eq]': String(projectId),
			'filter[tanggal][_eq]': tanggal,
			'filter[status][_eq]': 'baru',
			sort: 'date_created',
			fields: FIELDS,
			limit: '200'
		});
		rows = (await directusServerJson<{ data: any[] }>(`/items/${KOLEKSI}?${q.toString()}`))?.data || [];
	} catch (e) {
		return belumSiap(e);
	}
	const nama = await namaManpower(rows.map((r) => Number(idOf(r.manpower_id))));
	return rows.map((r) => ({
		...r,
		manpower_nama: nama.get(Number(idOf(r.manpower_id))) ?? r.dicatat_oleh ?? null
	}));
}

/** Cari file Directus lewat judul (dipakai id transaksi). Gagal baca → null + log (kirim ulang tetap jalan, risiko duplikat kecil). */
export async function cariFileByJudul(judul: string): Promise<string | null> {
	try {
		const q = new URLSearchParams({ 'filter[title][_eq]': judul, fields: 'id', limit: '1' });
		const r = await directusServerJson<{ data: any[] }>(`/files?${q.toString()}`);
		return r?.data?.[0]?.id ? String(r.data[0].id) : null;
	} catch (e) {
		console.warn('[kioskCatatan] cek file by judul gagal (dilewati):', (e as Error)?.message);
		return null;
	}
}

/** Catatan yang sudah memakai file ini (kirim ulang setelah respons hilang) → id catatan. */
export async function cariCatatanByFoto(projectId: number, fotoId: string): Promise<number | null> {
	try {
		const q = new URLSearchParams({
			'filter[project_id][_eq]': String(projectId),
			'filter[foto][_eq]': fotoId,
			fields: 'id',
			limit: '1'
		});
		const r = await directusServerJson<{ data: any[] }>(`/items/${KOLEKSI}?${q.toString()}`);
		return r?.data?.[0]?.id ? Number(r.data[0].id) : null;
	} catch (e) {
		return belumSiap(e);
	}
}

/** Catatan hanya-teks yang sama persis (orang, jenis pilihan, isi) dibuat < 2 menit lalu → id (ketuk/kirim ganda). */
export async function cariCatatanKembarTeks(projectId: number, manpowerId: number, tanggal: string, kategori: string, catatan: string): Promise<number | null> {
	if (!catatan.trim()) return null;
	try {
		const q = new URLSearchParams({
			'filter[project_id][_eq]': String(projectId),
			'filter[manpower_id][_eq]': String(manpowerId),
			'filter[tanggal][_eq]': tanggal,
			'filter[kategori][_eq]': kategori,
			'filter[status][_eq]': 'baru',
			fields: 'id,catatan,foto,date_created',
			sort: '-date_created',
			limit: '5'
		});
		const r = await directusServerJson<{ data: any[] }>(`/items/${KOLEKSI}?${q.toString()}`);
		const now = Date.now();
		const kembar = (r?.data || []).find((c) => !c.foto && String(c.catatan ?? '').trim() === catatan.trim() && now - new Date(c.date_created).getTime() < 120_000);
		return kembar ? Number(kembar.id) : null;
	} catch (e) {
		return belumSiap(e);
	}
}

/** Ubah status banyak catatan sekaligus. Hanya baris milik proyek ini yang disentuh; mengembalikan jumlah yang diubah. */
export async function tandaiCatatan(p: {
	projectId: number;
	ids: number[];
	status: 'dipakai' | 'diabaikan';
	reportId?: number | null;
	oleh: string;
}): Promise<number> {
	try {
		const own = await directusServerJson<{ data: any[] }>(
			`/items/${KOLEKSI}?filter[project_id][_eq]=${p.projectId}&filter[id][_in]=${p.ids.join(',')}&filter[status][_eq]=baru&fields=id&limit=-1`
		);
		const keys = (own?.data || []).map((r) => Number(r.id));
		if (!keys.length) return 0;
		await directusServerJson(`/items/${KOLEKSI}`, {
			method: 'PATCH',
			body: JSON.stringify({
				keys,
				data: {
					status: p.status,
					report_id: p.status === 'dipakai' ? p.reportId ?? null : null,
					diproses_oleh: p.oleh.slice(0, 128),
					diproses_pada: new Date().toISOString()
				}
			})
		});
		return keys.length;
	} catch (e) {
		return belumSiap(e);
	}
}
