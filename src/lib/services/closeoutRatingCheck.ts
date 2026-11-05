// src/lib/services/closeoutRatingCheck.ts
// Klien pemeriksaan "pekerja outsource sudah dinilai" di halaman closeout (gate G_MANPOWER_RATING_CLOSEOUT, KPI & Kinerja Terpusat Fase 6).
// Informatif bagi Leader; penegakan ada di Gerbang Closing admin. Tidak pernah melempar: gagal -> { available:false }.
import { getIdToken } from '$lib/services/secureDirectus';

export interface CloseoutRatingCheck {
	available: boolean;
	reason?: string;
	status?: 'passed' | 'failed';
	mode?: string;
	blocked?: boolean;
	detail?: { total: number; missing: number[] } | null;
}

export async function loadCloseoutRatingCheck(projectId: number): Promise<CloseoutRatingCheck> {
	try {
		const res = await fetch(`/api/proyek/closeout-rating-check?projectId=${encodeURIComponent(String(projectId))}`, {
			headers: { Authorization: `Bearer ${await getIdToken()}` }
		});
		const data = (await res.json().catch(() => null)) as CloseoutRatingCheck | null;
		if (!res.ok || !data) return { available: false, reason: `HTTP ${res.status}` };
		return data;
	} catch (e: any) {
		return { available: false, reason: e?.message || 'Gagal memuat' };
	}
}
