// src/lib/services/laporanReview.ts
// PRJ-18 §4.2 — klien tipis lintas-origin ke erp-epi untuk antrean review laporan harian (PM di lapangan). Keputusan memakai
// endpoint ERP yang sama dengan admin (izin PE_APPROVE_LAPORAN dicek di server): decide (satu laporan) dan bulk-approve.
import { getIdToken } from './secureDirectus';

const ADMIN_APP_ORIGIN = '';

export interface ReviewItem {
	id: number;
	project_id: number;
	project_name: string;
	date: string;
	prepared_by: string;
	quality_score: number | null;
	quality_flags: string[];
	bulkOk: boolean;
}

async function call(path: string, init: RequestInit = {}) {
	const token = await getIdToken();
	const res = await fetch(`${ADMIN_APP_ORIGIN}${path}`, {
		...init,
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) }
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(body?.message || `Permintaan gagal (${res.status})`);
	return body;
}

export async function fetchReviewQueue(limit = 100): Promise<ReviewItem[]> {
	return (await call(`/api/laporan/antrean?limit=${limit}`)).items || [];
}
export const approveReport = (id: number) => call(`/api/laporan/${id}/decide`, { method: 'POST', body: JSON.stringify({ decision: 'approved' }) });
export const requestRevision = (id: number, note: string) => call(`/api/laporan/${id}/decide`, { method: 'POST', body: JSON.stringify({ decision: 'revision_requested', note }) });
export const bulkApproveReports = (ids: number[]): Promise<{ approved: number[]; skipped: { id: number; reason: string }[] }> =>
	call('/api/laporan/bulk-approve', { method: 'POST', body: JSON.stringify({ ids }) });

export const FLAG_LABEL: Record<string, string> = {
	G_LH_JADWAL: 'Jadwal kegiatan kosong', G_LH_RENCANA_BESOK: 'Rencana besok kosong', G_LH_PROGRESS: 'Progress kosong',
	G_LH_FOTO_PROGRESS: 'Foto progress belum ada', G_LH_MATERIAL_TERPAKAI: 'Material terpakai kosong', G_LH_TENAGA_KERJA: 'Daftar pekerja kosong',
	G_LH_FOTO_ABSENSI: 'Foto absensi belum ada', G_LH_CUACA: 'Cuaca belum diisi', G_LH_JML_TENAGA: 'Jumlah tenaga belum diisi',
	G_LH_CATATAN_UMUM: 'Catatan umum kosong', G_LH_KENDALA_UMUM: 'Kendala umum kosong', G_LH_PROGRESS_SUBTASK: 'Progress tanpa subtask',
	G_LH_PROGRESS_CATATAN: 'Progress tanpa catatan', G_LH_KARYAWAN_ID: 'Tidak tertaut akun leader', G_LH_HOLD_ALASAN: 'Hold tanpa alasan'
};
