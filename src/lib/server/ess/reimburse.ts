// src/lib/server/ess/reimburse.ts
// Query helper server-side untuk /api/ess/reimburse/* — reuse koleksi
// klaim_reimbursement yang sudah dipakai Admin HRD (hrdPayrollApi.js).

import { directusServerJson } from '$lib/server/directus';
import { listKaryawanIdsByDivisi } from '$lib/server/ess/divisi';

export interface ReimburseRecord {
	id: string;
	karyawan_id: string;
	tanggal_pengajuan: string;
	kategori: string;
	jumlah: number;
	bukti_pendukung: string | null;
	status: string;
	catatan: string | null;
	approver_id: string | null;
	approved_at: string | null;
}

const REIMBURSE_FIELDS = [
	'id', 'karyawan_id', 'tanggal_pengajuan', 'kategori', 'jumlah', 'bukti_pendukung',
	'status', 'catatan', 'approver_id', 'approved_at'
].join(',');

export async function findReimburseById(id: string): Promise<ReimburseRecord | null> {
	try {
		const result = await directusServerJson<{ data: ReimburseRecord }>(
			`/items/klaim_reimbursement/${id}?fields=${REIMBURSE_FIELDS}`
		);
		return result?.data || null;
	} catch {
		return null;
	}
}

export async function listReimburseByKaryawan(karyawanId: number): Promise<ReimburseRecord[]> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		fields: REIMBURSE_FIELDS,
		sort: '-tanggal_pengajuan',
		limit: '100'
	});
	const result = await directusServerJson<{ data: ReimburseRecord[] }>(`/items/klaim_reimbursement?${query.toString()}`);
	return result?.data || [];
}

/** Inbox approval: klaim status Diajukan milik karyawan lain di divisi yang sama. */
export async function listPendingReimburseForDivisi(divisi: string, excludeKaryawanId: number): Promise<ReimburseRecord[]> {
	if (!divisi) return [];
	const idsInDivisi = await listKaryawanIdsByDivisi(divisi);
	const targetIds = idsInDivisi.filter((id) => id !== excludeKaryawanId);
	if (targetIds.length === 0) return [];

	const query = new URLSearchParams({
		'filter[karyawan_id][_in]': targetIds.join(','),
		'filter[status][_eq]': 'Diajukan',
		fields: REIMBURSE_FIELDS,
		sort: 'tanggal_pengajuan',
		limit: '100'
	});
	const result = await directusServerJson<{ data: ReimburseRecord[] }>(`/items/klaim_reimbursement?${query.toString()}`);
	return result?.data || [];
}

/** Riwayat approval: klaim reimbursement yang sudah diproses (Disetujui/Ditolak) milik karyawan divisi yang sama. */
export async function listHistoryReimburseForDivisi(divisi: string, excludeKaryawanId: number): Promise<ReimburseRecord[]> {
	if (!divisi) return [];
	const idsInDivisi = await listKaryawanIdsByDivisi(divisi);
	const targetIds = idsInDivisi.filter((id) => id !== excludeKaryawanId);
	if (targetIds.length === 0) return [];

	const query = new URLSearchParams({
		'filter[karyawan_id][_in]': targetIds.join(','),
		'filter[status][_neq]': 'Diajukan',
		fields: REIMBURSE_FIELDS,
		sort: '-approved_at,-tanggal_pengajuan',
		limit: '100'
	});
	const result = await directusServerJson<{ data: ReimburseRecord[] }>(`/items/klaim_reimbursement?${query.toString()}`);
	return result?.data || [];
}

