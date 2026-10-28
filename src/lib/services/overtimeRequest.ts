import directus, { handleDirectusError } from './directus';
import { readItems, createItem } from '@directus/sdk';

// ── Pengajuan Lembur Manpower (Fase 3, Manpower v2) ─────────────────────
// PL mengajukan dari sini; HRD menyetujui/menolak di erp-epi-1
// (HrdOvertimeControl.svelte / overtimeRequestApi.js). TIDAK mengubah
// ot_hours di manpower_absensi — itu tetap dicatat terpisah saat absensi
// harian seperti biasa; ini murni jejak pengajuan+persetujuan sebelum
// lembur dikerjakan.

export interface OvertimeRequest {
	id: number;
	assignment_id: number;
	manpower_id: number;
	project_id: number;
	tanggal: string;
	jam_diajukan: number;
	alasan: string | null;
	status: 'pending' | 'disetujui' | 'ditolak';
	diajukan_oleh: string | null;
	disetujui_oleh: string | null;
	catatan_approval: string | null;
	date_created?: string;
}

export async function submitOvertimeRequest(p: {
	assignmentId: number;
	manpowerId: number;
	projectId: number;
	tanggal: string;
	jamDiajukan: number;
	alasan: string;
	diajukanOleh: string;
}) {
	try {
		const created = await directus.request(
			createItem('overtime_request', {
				assignment_id: p.assignmentId,
				manpower_id: p.manpowerId,
				project_id: p.projectId,
				tanggal: p.tanggal,
				jam_diajukan: p.jamDiajukan,
				alasan: p.alasan,
				status: 'pending',
				diajukan_oleh: p.diajukanOleh,
				// Lapis 1 Manpower Leader — di-set eksplisit di sini, BUKAN lewat default
				// kolom. Kolom berdefault akan mengisi SELURUH baris lama dan membanjiri
				// antrean (gotcha Fase 0, lihat rencana-manpower-leader.md §10).
				verifikasi_leader_status: 'menunggu'
			})
		);
		return { success: true, data: created };
	} catch (error) {
		handleDirectusError(error);
		return { success: false, error: (error as any)?.message || 'Gagal mengajukan lembur' };
	}
}

/** Riwayat pengajuan untuk satu proyek (dilihat PL untuk cek status). */
export async function getOvertimeRequestsForProject(projectId: number): Promise<OvertimeRequest[]> {
	try {
		const rows = (await directus.request(
			readItems('overtime_request', {
				fields: ['*', 'manpower_id.nama'],
				filter: { project_id: { _eq: projectId } },
				sort: ['-tanggal'],
				limit: -1
			})
		)) as any[];
		return rows || [];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}
