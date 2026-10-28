// src/lib/services/fieldExportApi.ts
// Fase "Export Universal — Dashboard Lapangan" (§5.4 rencana).
//
// Flattener TIPIS untuk export lapangan. Setiap fungsi hanya memanggil SERVICE
// LAPANGAN yang sudah ada, lalu meratakan jadi baris datar.
//
// ATURAN KERAS (§5.4 P2 — data sensitif MUTLAK DILARANG keluar ke lapangan):
//   • TIDAK ADA kolom harga / nilai / margin / HPP / kontrak di sini.
//     Contoh: getPackingRequests() membawa `unit_price` — flattener di bawah
//     SENGAJA membuangnya, hanya kuantitas & satuan yang keluar.
//   • Ini daftar putih terpisah, BUKAN registry admin yang difilter. Section
//     sensitif tidak pernah punya entri di file ini.
//
// Kontrak: (projectId, opts?) => Promise<Array<Record<string, unknown>>>
//   opts.dateRange = { from?: 'YYYY-MM-DD'; to?: 'YYYY-MM-DD' }

import { getProjectInventory, getProjectInventoryLogs } from '$lib/services/projectStockInventoryApi';
import { fetchWbsTree } from '$lib/services/wbsApi';
import { getReports } from '$lib/services/reports';
import { getAbsensiForProjectsInRange } from '$lib/services/manpowerAbsensi';
import { getPackingRequests } from '$lib/services/packingList';
import { fetchProjectPunchList } from '$lib/services/projectPunchListApi';

export interface FieldDateRange {
	from?: string;
	to?: string;
}
export interface FieldExportOpts {
	dateRange?: FieldDateRange;
}

/* ------------------------------------------------------------------ helpers */

export function pick(obj: unknown, path: string): unknown {
	if (obj == null) return '';
	const v = String(path)
		.split('.')
		.reduce<unknown>((acc, k) => (acc == null ? undefined : (acc as Record<string, unknown>)[k]), obj);
	return v == null ? '' : v;
}

export interface FieldColumn {
	header: string;
	key: string;
	type?: 'number' | 'date' | 'text';
}

/** Ratakan array baris mentah → array baris datar sesuai `columns` (null-safe). */
export function flattenForField(
	rows: unknown,
	columns: FieldColumn[]
): Array<Record<string, unknown>> {
	const list = Array.isArray(rows) ? rows : [];
	return list.map((r) => {
		const out: Record<string, unknown> = {};
		for (const c of columns) {
			let v = pick(r, c.key);
			if (c.type === 'number') {
				const n = typeof v === 'number' ? v : parseFloat(String(v));
				v = Number.isFinite(n) ? n : 0;
			} else if (c.type === 'date' && v) {
				v = String(v).slice(0, 10);
			}
			out[c.key] = v;
		}
		return out;
	});
}

function inRange(dateStr: unknown, range?: FieldDateRange): boolean {
	if (!range || (!range.from && !range.to)) return true;
	const d = String(dateStr ?? '').slice(0, 10);
	if (!d) return true;
	if (range.from && d < range.from) return false;
	if (range.to && d > range.to) return false;
	return true;
}

/* --------------------------------------------------------------- flatteners */

export async function flattenInventoryForField(projectId: number): Promise<Array<Record<string, unknown>>> {
	const rows = await getProjectInventory(projectId);
	return Array.isArray(rows) ? (rows as unknown as Array<Record<string, unknown>>) : [];
}

export async function flattenStockLogForField(
	projectId: number,
	opts: FieldExportOpts = {}
): Promise<Array<Record<string, unknown>>> {
	const rows = await getProjectInventoryLogs(projectId);
	const list = Array.isArray(rows) ? (rows as unknown as Array<Record<string, unknown>>) : [];
	return list.filter((r) => inRange(r.date, opts.dateRange));
}

export async function flattenTimelineForField(projectId: number): Promise<Array<Record<string, unknown>>> {
	const { flat } = await fetchWbsTree(projectId);
	return Array.isArray(flat) ? (flat as unknown as Array<Record<string, unknown>>) : [];
}

export async function flattenLaporanHarianForField(
	projectId: number,
	opts: FieldExportOpts = {}
): Promise<Array<Record<string, unknown>>> {
	const rows = await getReports(projectId, { limit: 500 });
	const list = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
	return list.filter((r) => inRange((r.tanggal as string) || (r.date as string), opts.dateRange));
}

export async function flattenAbsensiForField(
	projectId: number,
	opts: FieldExportOpts = {}
): Promise<Array<Record<string, unknown>>> {
	const range = opts.dateRange || {};
	// getAbsensiForProjectsInRange butuh rentang — default 90 hari terakhir bila kosong.
	const to = range.to || new Date().toISOString().slice(0, 10);
	const from =
		range.from ||
		new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
	const rows = await getAbsensiForProjectsInRange([projectId], from, to);
	return Array.isArray(rows) ? (rows as unknown as Array<Record<string, unknown>>) : [];
}

export async function flattenPackingListForField(projectId: number): Promise<Array<Record<string, unknown>>> {
	const rows = await getPackingRequests(projectId, { limit: 500 });
	const list = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
	// Buang unit_price secara eksplisit — tidak boleh keluar ke lapangan.
	return list.map((r) => {
		const clone: Record<string, unknown> = { ...r };
		delete clone.unit_price;
		return clone;
	});
}

export async function flattenPunchListForField(projectId: number): Promise<Array<Record<string, unknown>>> {
	const rows = await fetchProjectPunchList(projectId);
	return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

/* -------------------------------------------------- foto laporan harian (B3) */

function parseIdArray(val: unknown): string[] {
	if (Array.isArray(val)) return val.map((v) => String(v)).filter(Boolean);
	if (typeof val === 'string' && val.trim()) {
		try {
			const p = JSON.parse(val);
			return Array.isArray(p) ? p.map((v) => String(v)).filter(Boolean) : [];
		} catch {
			return [];
		}
	}
	return [];
}

const FOTO_KATEGORI: Record<string, string> = {
	progress_photos: 'Progress',
	attendance_photos: 'Kehadiran',
	issue_photos: 'Kendala',
	weekend_photos: 'Akhir Pekan'
};
const MAX_FOTO = 60; // batas wajar untuk 1 PDF

/**
 * Baris = SATU FOTO. Dipakai endpoint untuk render grid foto (server-side,
 * Gotenberg) — bukan tabel. `fileId` diresolusi jadi gambar di server.
 */
export async function flattenLaporanHarianFotoForField(
	projectId: number,
	opts: FieldExportOpts = {}
): Promise<Array<Record<string, unknown>>> {
	const reports = await getReports(projectId, { limit: 200 });
	const list = Array.isArray(reports) ? (reports as Array<Record<string, unknown>>) : [];
	const out: Array<Record<string, unknown>> = [];
	for (const r of list) {
		const tgl = String((r.tanggal as string) || (r.date as string) || '').slice(0, 10);
		if (!inRange(tgl, opts.dateRange)) continue;
		const ket = String((r.pekerjaan_dilakukan as string) || (r.kendala as string) || '').slice(0, 180);
		for (const [field, kategori] of Object.entries(FOTO_KATEGORI)) {
			for (const fileId of parseIdArray(r[field])) {
				out.push({ tanggal: tgl, kategori, keterangan: ket, fileId });
				if (out.length >= MAX_FOTO) return out;
			}
		}
	}
	return out;
}
