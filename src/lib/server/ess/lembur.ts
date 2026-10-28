// src/lib/server/ess/lembur.ts
// Query helper server-side untuk /api/ess/lembur/* — pola identik ess/cuti.ts.

import { directusServerJson } from '$lib/server/directus';
import { listKaryawanIdsByDivisi } from '$lib/server/ess/divisi';

export interface LemburRecord {
	id: string;
	karyawan_id: string;
	tanggal: string;
	jam_mulai: string | null;
	jam_selesai: string | null;
	alasan: string | null;
	bukti: string | null;
	status: string;
	approver_id: string | null;
	approved_at: string | null;
	catatan_approval: string | null;
	durasi_jam: number | null;
	is_hari_libur: boolean | null;
	requires_hrd_approval: boolean | null;
	atasan_approver_id: number | null;
	disetujui_atasan_at: string | null;
}

const LEMBUR_FIELDS = [
	'id', 'karyawan_id', 'tanggal', 'jam_mulai', 'jam_selesai', 'alasan', 'bukti',
	'status', 'approver_id', 'approved_at', 'catatan_approval', 'durasi_jam', 'is_hari_libur',
	'requires_hrd_approval', 'atasan_approver_id', 'disetujui_atasan_at'
].join(',');

export async function findLemburById(id: string): Promise<LemburRecord | null> {
	try {
		const result = await directusServerJson<{ data: LemburRecord }>(`/items/ess_lembur/${id}?fields=${LEMBUR_FIELDS}`);
		return result?.data || null;
	} catch {
		return null;
	}
}

export async function listLemburByKaryawan(karyawanId: number): Promise<LemburRecord[]> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		fields: LEMBUR_FIELDS,
		sort: '-tanggal',
		limit: '100'
	});
	const result = await directusServerJson<{ data: LemburRecord[] }>(`/items/ess_lembur?${query.toString()}`);
	return result?.data || [];
}

/** Inbox approval: pengajuan status Diajukan milik karyawan lain di divisi yang sama. */
export async function listPendingLemburForDivisi(divisi: string, excludeKaryawanId: number): Promise<LemburRecord[]> {
	if (!divisi) return [];
	const idsInDivisi = await listKaryawanIdsByDivisi(divisi);
	const targetIds = idsInDivisi.filter((id) => id !== excludeKaryawanId);
	if (targetIds.length === 0) return [];

	const query = new URLSearchParams({
		'filter[karyawan_id][_in]': targetIds.join(','),
		'filter[status][_eq]': 'Diajukan',
		fields: LEMBUR_FIELDS,
		sort: 'tanggal',
		limit: '100'
	});
	const result = await directusServerJson<{ data: LemburRecord[] }>(`/items/ess_lembur?${query.toString()}`);
	return result?.data || [];
}

/** Riwayat approval: pengajuan lembur yang sudah diproses (Disetujui/Ditolak) milik karyawan divisi yang sama. */
export async function listHistoryLemburForDivisi(divisi: string, excludeKaryawanId: number): Promise<LemburRecord[]> {
	if (!divisi) return [];
	const idsInDivisi = await listKaryawanIdsByDivisi(divisi);
	const targetIds = idsInDivisi.filter((id) => id !== excludeKaryawanId);
	if (targetIds.length === 0) return [];

	const query = new URLSearchParams({
		'filter[karyawan_id][_in]': targetIds.join(','),
		'filter[status][_neq]': 'Diajukan',
		fields: LEMBUR_FIELDS,
		sort: '-approved_at,-tanggal',
		limit: '100'
	});
	const result = await directusServerJson<{ data: LemburRecord[] }>(`/items/ess_lembur?${query.toString()}`);
	return result?.data || [];
}

