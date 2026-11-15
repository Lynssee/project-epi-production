// src/lib/services/ess/kategoriKpi.ts
// Klien "Skor Kategori Departemen Saya" (5 kategori + saran tindakan). Cache memori 2 menit (hemat kuota lapangan).
// Tidak pernah melempar: gagal -> { available:false }.
import { getIdToken } from '$lib/services/secureDirectus';

export type KategoriKey = 'general' | 'teknis' | 'administrasi' | 'keuangan' | 'inovasi';
export const KATEGORI_URUT: KategoriKey[] = ['general', 'teknis', 'administrasi', 'keuangan', 'inovasi'];
export const KATEGORI_META: Record<KategoriKey, { label: string; hint: string; bar: string; badge: string }> = {
	general: { label: 'General', hint: 'Kedisiplinan: absensi, laporan harian, P2H, bebas SP, pelatihan.', bar: 'bg-purple-500', badge: 'bg-purple-100 text-purple-700' },
	teknis: { label: 'Teknis', hint: 'Hasil kerja fungsi inti departemen.', bar: 'bg-blue-500', badge: 'bg-blue-100 text-blue-700' },
	administrasi: { label: 'Administrasi', hint: 'Ketertiban dokumen, laporan, dan SLA.', bar: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700' },
	keuangan: { label: 'Keuangan', hint: 'Kontrol anggaran dan efisiensi biaya.', bar: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700' },
	inovasi: { label: 'Inovasi', hint: 'Pengembangan kompetensi dan perbaikan kerja.', bar: 'bg-cyan-500', badge: 'bg-cyan-100 text-cyan-700' }
};

export interface KategoriSkor { score: number | null; status: string | null; effectiveWeight: number }
export interface KategoriNudge { id: string; severity: 'critical' | 'warning'; category: string; categoryLabel: string; title: string; detail: string }
export interface KategoriKpiSaya {
	available: boolean;
	reason?: string;
	department?: string;
	month?: string;
	mode?: 'shadow' | 'on';
	thresholds?: { onTarget: number; warning: number };
	composite?: number | null;
	missing?: string[];
	categories?: Record<string, KategoriSkor>;
	nudges?: KategoriNudge[];
}

const TTL_MS = 2 * 60 * 1000;
let cache: { at: number; data: KategoriKpiSaya } | null = null;

export async function getKategoriKpiSaya(force = false): Promise<KategoriKpiSaya> {
	if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
	try {
		const res = await fetch('/api/ess/kategori-kpi', { headers: { Authorization: `Bearer ${await getIdToken()}` } });
		const data = (await res.json().catch(() => null)) as KategoriKpiSaya | null;
		if (!res.ok || !data) return { available: false, reason: `HTTP ${res.status}` };
		if (data.available) cache = { at: Date.now(), data };
		return data;
	} catch (e: any) {
		return { available: false, reason: e?.message || 'Gagal memuat' };
	}
}
