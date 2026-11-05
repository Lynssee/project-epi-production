// src/lib/services/kesiapanDokumen.ts
// Klien tipis kesiapan DOKUMEN proyek (kalibrasi alat & sertifikasi personel) — Expired Date v2 Fase 5.
// Lewat proxy project-epi → erp-epi. Tidak pernah melempar; gagal = null (kartu disembunyikan).
import { getIdToken } from './secureDirectus';

export type KesiapanState = 'ok' | 'perhatian' | 'not_ok' | 'na';
export interface KesiapanItem {
	id: string | number;
	nama: string;
	tanggal: string | null;
	status: 'lewat' | 'segera' | 'ok' | 'belum_ada_data';
}
export interface KesiapanKelompok {
	state: KesiapanState;
	detail: string;
	items: KesiapanItem[];
	catatan?: string;
}
export interface KesiapanDokumen {
	projectId: number | string;
	today: string;
	alat: KesiapanKelompok;
	personel: KesiapanKelompok;
	sumber_gagal: string[];
	syncedAt: string;
}

export async function fetchKesiapanDokumen(projectId: number | string, force = false): Promise<KesiapanDokumen | null> {
	try {
		const token = await getIdToken();
		const res = await fetch(`/api/project/${encodeURIComponent(String(projectId))}/kesiapan-dokumen${force ? '?force=1' : ''}`, {
			headers: { Authorization: `Bearer ${token}` }
		});
		if (!res.ok) {
			console.warn(`[kesiapanDokumen] gagal memuat (HTTP ${res.status}).`);
			return null;
		}
		return (await res.json()) as KesiapanDokumen;
	} catch (e: any) {
		console.warn('[kesiapanDokumen] gagal memuat:', e?.message || e);
		return null;
	}
}

export const KESIAPAN_UI: Record<KesiapanState, { ikon: string; label: string; bg: string; fg: string }> = {
	ok: { ikon: '✅', label: 'Berlaku', bg: '#DCFCE7', fg: '#166534' },
	perhatian: { ikon: '⏳', label: 'Segera habis', bg: '#FEF9C3', fg: '#854D0E' },
	not_ok: { ikon: '⛔', label: 'Ada yang lewat', bg: '#FEE2E2', fg: '#B91C1C' },
	na: { ikon: '•', label: 'Belum ada data', bg: '#F3F4F6', fg: '#374151' }
};
