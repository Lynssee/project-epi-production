import directus from './directus';
import { createItem } from '@directus/sdk';

// ── Penilaian PL/Foreman (Fase 4, Manpower v2) ──────────────────────────
// Kualitas/Safety/Ketepatan dinilai manual di sini (bintang 1-5). Kehadiran &
// Skill DIHITUNG OTOMATIS di HRD (workerScorecardApi.js, erp-epi-1) dari data
// yang sudah ada — tidak diinput ulang di sini.

export async function submitWorkerRating(p: {
	manpowerId: number;
	projectId: number;
	kualitas: number;
	safety: number;
	ketepatan: number;
	catatan: string;
	dinilaiOleh: string;
}) {
	try {
		const created = await directus.request(
			createItem('worker_performance_rating', {
				manpower_id: p.manpowerId,
				project_id: p.projectId,
				tanggal: new Date().toISOString().split('T')[0],
				kualitas: p.kualitas,
				safety: p.safety,
				ketepatan: p.ketepatan,
				catatan: p.catatan,
				dinilai_oleh: p.dinilaiOleh
			})
		);
		return { success: true, data: created };
	} catch (error) {
		console.error('submitWorkerRating gagal:', (error as any)?.message);
		return { success: false, error: (error as any)?.message || 'Gagal menyimpan penilaian' };
	}
}
