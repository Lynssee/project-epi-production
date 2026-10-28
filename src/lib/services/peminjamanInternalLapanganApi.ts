// src/lib/services/peminjamanInternalLapanganApi.ts
// Fase 3, Rencana v2 "Lifecycle Pengembalian Barang" (§5.2, K1 WAJIB_KEMBALI) — countdown
// alat/barang pinjaman internal (peminjaman_internal) yang wajib dikembalikan peminjam yang
// login. Pola sama persis dengan sewaAlatLapanganApi.ts (§9.2 L3) -- relasi di-fetch
// TERPISAH, bukan nested fields (CLAUDE.md Aturan #2).
import { get } from 'svelte/store';
import directus from './directus';
import { readItems } from '@directus/sdk';
import { authStore } from '$lib/stores/auth';

/** Status yang berarti "masih di tangan peminjam, belum kembali". */
export const STATUS_PINJAMAN_AKTIF = ['disetujui', 'dipinjam', 'overdue'];

export interface PeminjamanSayaRow {
	id: number;
	reference_no: string | null;
	item_id: number | null;
	item_name: string;
	quantity: number;
	status: string;
	tanggal_pinjam: string | null;
	tanggal_jatuh_tempo: string | null;
	/** Hari tersisa sampai tanggal_jatuh_tempo (negatif = sudah lewat tenggat). Null kalau tenggat kosong. */
	hariTersisa: number | null;
}

function hitungHariTersisa(tanggalJatuhTempo: string | null): number | null {
	if (!tanggalJatuhTempo) return null;
	const target = new Date(tanggalJatuhTempo);
	if (isNaN(target.getTime())) return null;
	const now = new Date();
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const diffMs = target.getTime() - startOfToday.getTime();
	return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Daftar peminjaman_internal AKTIF (belum dikembalikan/ditolak) milik karyawan yang login.
 * TIDAK PERNAH query tanpa filter peminjam_id -- akan bocor data peminjam lain.
 */
export async function fetchPeminjamanSayaMendekatiTenggat(): Promise<PeminjamanSayaRow[]> {
	const s = get(authStore);
	const karyawanId = s?.karyawanId;
	if (!karyawanId) return [];

	const rows = (await directus.request(
		readItems('peminjaman_internal' as any, {
			filter: {
				peminjam_id: { _eq: karyawanId },
				status: { _in: STATUS_PINJAMAN_AKTIF }
			},
			fields: ['id', 'reference_no', 'item_id', 'quantity', 'status', 'tanggal_pinjam', 'tanggal_jatuh_tempo'],
			sort: ['tanggal_jatuh_tempo'],
			limit: -1
		})
	)) as any[];

	if (!rows.length) return [];

	const itemIds = [...new Set(rows.map((r) => r.item_id).filter(Boolean))];
	const itemMap = new Map<number, string>();
	if (itemIds.length) {
		const items = (await directus.request(
			readItems('identitas_barang' as any, {
				filter: { id: { _in: itemIds } },
				fields: ['id', 'nama_barang_lengkap'],
				limit: -1
			})
		)) as any[];
		items.forEach((it) => itemMap.set(it.id, it.nama_barang_lengkap));
	}

	return rows.map((r) => ({
		id: r.id,
		reference_no: r.reference_no || null,
		item_id: r.item_id || null,
		item_name: r.item_id ? itemMap.get(r.item_id) || `Item #${r.item_id}` : '-',
		quantity: Number(r.quantity || 0),
		status: r.status,
		tanggal_pinjam: r.tanggal_pinjam || null,
		tanggal_jatuh_tempo: r.tanggal_jatuh_tempo || null,
		hariTersisa: hitungHariTersisa(r.tanggal_jatuh_tempo)
	}));
}
