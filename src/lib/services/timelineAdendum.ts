// Timeline Adendum — pengajuan revisi jadwal/volume oleh Leader (lapangan).
// Koleksi `project_timeline_adendum` & field `timeline_version` di `projects`
// sudah dibuat lewat erp-epi-1; service ini adalah counterpart sisi lapangan.
// Approve/reject TETAP hanya bisa dilakukan dari erp-epi-1 (PM/Atasan Project) —
// leader di sini hanya boleh submit + lihat riwayat pengajuannya sendiri.

import directus, { createUserDirectus, handleDirectusError } from './directus';
import { readItems, createItem } from '@directus/sdk';
import { getIdToken } from './secureDirectus';

export interface AdendumDiffSummary {
	task?: string;
	subtask?: string;
	shiftDays: number;
	oldLastPlanDate: string | null;
	newLastPlanDate: string | null;
	oldVolume: number;
	newVolume: number;
}

/**
 * Ajukan adendum timeline dari lapangan. Menyimpan snapshot_before + proposed_changes
 * sebagai record independen — TIDAK langsung mengubah timeline_planning aktif project.
 */
export async function createAdendum(params: {
	projectId: number;
	directusToken?: string | null;
	requestedByName: string;
	snapshotBefore: any;
	proposedChanges: any;
	diffSummary: AdendumDiffSummary;
	alasan: string;
	catatanDampakBiaya?: string | null;
}) {
	try {
		const { projectId, directusToken, requestedByName, snapshotBefore, proposedChanges, diffSummary, alasan, catatanDampakBiaya } = params;
		const client = directusToken ? createUserDirectus(directusToken) : directus;

		const existing = await directus.request(
			readItems('project_timeline_adendum', {
				filter: { project_id: { _eq: projectId } },
				fields: ['id'],
				limit: -1
			})
		);
		const urutan = (existing?.length || 0) + 1;
		const tahun = new Date().getFullYear();
		const nomorAdendum = `ADD-${tahun}-${projectId}-${String(urutan).padStart(2, '0')}`;

		const result: any = await client.request(
			createItem('project_timeline_adendum', {
				project_id: projectId,
				nomor_adendum: nomorAdendum,
				versi: urutan,
				sumber_pengajuan: 'lapangan',
				requested_by_name: requestedByName,
				tanggal_pengajuan: new Date().toISOString(),
				alasan,
				catatan_dampak_biaya: catatanDampakBiaya || null,
				snapshot_before: snapshotBefore,
				proposed_changes: proposedChanges,
				diff_summary: diffSummary,
				status: 'pending'
			})
		);

		await notifyAdendumSubmitted(result.id, nomorAdendum, requestedByName, alasan, projectId);

		return { success: true, data: result };
	} catch (error: any) {
		handleDirectusError(error);
		return { success: false, error: error?.message || 'Gagal membuat pengajuan adendum' };
	}
}

/**
 * Riwayat pengajuan adendum untuk satu project (dilihat oleh leader — semua status).
 */
export async function listAdendumByProject(projectId: number) {
	try {
		const result = await directus.request(
			readItems('project_timeline_adendum', {
				filter: { project_id: { _eq: projectId } },
				sort: ['-tanggal_pengajuan'],
				limit: -1
			})
		);
		return result || [];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

async function notifyAdendumSubmitted(adendumId: number, nomorAdendum: string, requestedByName: string, alasan: string, projectId: number) {
	try {
		const token = await getIdToken();
		await fetch('/api/timeline-adendum/notify-submitted', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({
				adendumId,
				projectId,
				message: `📅 Adendum Timeline ${nomorAdendum}: ${requestedByName} mengajukan revisi jadwal dari lapangan. Alasan: ${alasan}`
			})
		});
	} catch (err) {
		console.warn('Gagal mengirim notifikasi adendum:', err);
	}
}
