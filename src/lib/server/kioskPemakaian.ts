// src/lib/server/kioskPemakaian.ts
// Draf Pemakaian Barang kru (Rencana Kiosk Proyek, Fase 5) — koleksi `kiosk_pemakaian_draf`.
// Draf = kotak masuk saja; TIDAK menulis project_expenses maupun ledger (lihat utils/kioskPemakaian.ts).
// Query dipisah per relasi. Koleksi dipasang terpisah (skema = izin Lead); sebelum itu gagal-lunak dengan 503
// yang jelas dan penyebab asli di log.

import { error } from '@sveltejs/kit';
import { directusServerJson } from '$lib/server/directus';
import { idOf } from '$lib/server/manpowerAbsensiCore';
import { namaManpower } from '$lib/server/kioskProyekDevice';
import { susunBarang, type BarangProyek, type DrafPemakaian } from '$lib/utils/kioskPemakaian';

const KOLEKSI = 'kiosk_pemakaian_draf';
const FIELDS = 'id,project_id,manpower_id,tanggal,expense_id,identitas_barang_id,nama_barang,satuan,qty,catatan,foto,status,perangkat_id,dicatat_oleh,date_created';

function belumSiap(e: unknown): never {
	console.error(`[kioskPemakaian] akses ${KOLEKSI} gagal (skema belum dipasang atau izin token kurang?):`, (e as Error)?.message);
	throw error(503, 'Fitur Draf Pemakaian Barang belum disiapkan di server. Hubungi admin.');
}

// ---- daftar barang yang boleh dipilih kru: baris RAP Actual (project_expenses) dengan sisa > 0 ----
const barangCache = new Map<number, { at: number; data: BarangProyek[] }>();
export function invalidateBarang(projectId: number): void {
	barangCache.delete(projectId);
}

export async function daftarBarangProyek(projectId: number, cacheDetik: number): Promise<BarangProyek[]> {
	const hit = barangCache.get(projectId);
	if (hit && cacheDetik > 0 && Date.now() - hit.at < cacheDetik * 1000) return hit.data;
	// Jenis & field SAMA dengan getProjectActualMaterials (daftar material di form Laporan Harian).
	const q = new URLSearchParams({
		'filter[project_id][_eq]': String(projectId),
		'filter[expense_type][_in]': 'supplier,consumable,safety',
		fields: 'id,material_name,description,unit,qty,qty_used,qty_remaining,identitas_barang_id',
		limit: '-1'
	});
	const res = await directusServerJson<{ data: any[] }>(`/items/project_expenses?${q.toString()}`);
	const data = susunBarang(res?.data);
	barangCache.set(projectId, { at: Date.now(), data });
	return data;
}

export async function jumlahDrafHariIni(projectId: number, manpowerId: number, tanggal: string): Promise<number> {
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

/** Draf kembar (orang + barang + jumlah sama, masih baru, dibuat < 2 menit lalu) → id yang sudah ada (ketuk ganda tidak menggandakan). */
export async function cariDrafKembar(projectId: number, manpowerId: number, tanggal: string, expenseId: number, qty: number): Promise<number | null> {
	try {
		const q = new URLSearchParams({
			'filter[project_id][_eq]': String(projectId),
			'filter[manpower_id][_eq]': String(manpowerId),
			'filter[tanggal][_eq]': tanggal,
			'filter[expense_id][_eq]': String(expenseId),
			'filter[status][_eq]': 'baru',
			fields: 'id,qty,date_created',
			sort: '-date_created',
			limit: '5'
		});
		const r = await directusServerJson<{ data: any[] }>(`/items/${KOLEKSI}?${q.toString()}`);
		const now = Date.now();
		const kembar = (r?.data || []).find((d) => Number(d.qty) === qty && now - new Date(d.date_created).getTime() < 120_000);
		return kembar ? Number(kembar.id) : null;
	} catch (e) {
		return belumSiap(e);
	}
}

export async function simpanDraf(p: {
	projectId: number;
	manpowerId: number;
	tanggal: string;
	barang: BarangProyek;
	qty: number;
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
				// Nama/satuan/identitas DISALIN dari project_expenses di server — bukan dari kiriman klien.
				expense_id: p.barang.expense_id,
				identitas_barang_id: p.barang.identitas_barang_id,
				nama_barang: p.barang.nama.slice(0, 255),
				satuan: p.barang.satuan.slice(0, 32),
				qty: p.qty,
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

export interface DrafRow extends DrafPemakaian {
	project_id: number;
	manpower_id: number;
	tanggal: string;
	foto: string | null;
	status: string;
	date_created: string | null;
}

export async function daftarDrafBaru(projectId: number, tanggal: string): Promise<DrafRow[]> {
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
		qty: Number(r.qty),
		manpower_nama: nama.get(Number(idOf(r.manpower_id))) ?? r.dicatat_oleh ?? null
	}));
}

export async function tandaiDraf(p: {
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
