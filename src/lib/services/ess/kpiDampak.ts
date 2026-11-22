// src/lib/services/ess/kpiDampak.ts
// Klien "Dampak KPI Saya" (arah dampak finansial indikator departemen; angka Rp hanya bila admin mengizinkan).
// Cache memori 2 menit (hemat kuota lapangan). Tidak pernah melempar: gagal -> { available:false }.
import { getIdToken } from '$lib/services/secureDirectus';

export type DampakArah = 'lebih_baik' | 'sejajar' | 'perlu_perhatian';
export interface DampakItem {
	kpi_code: string;
	name: string;
	arah: DampakArah;
	label: 'Estimasi' | 'Aktual';
	penjelasan: string;
	/** Hanya ada bila admin memilih mode "arah + Rp". */
	rp?: number;
}
export interface KpiDampakSaya {
	available: boolean;
	reason?: string;
	department?: string;
	month?: string;
	mode?: 'arah' | 'rp';
	items?: DampakItem[];
	terhitung?: number;
}

export const ARAH_META: Record<DampakArah, { simbol: string; teks: string; cls: string }> = {
	lebih_baik: { simbol: '↑', teks: 'Lebih baik dari target', cls: 'text-emerald-600' },
	sejajar: { simbol: '→', teks: 'Sejajar dengan target', cls: 'text-slate-500' },
	perlu_perhatian: { simbol: '↓', teks: 'Perlu perhatian', cls: 'text-rose-600' }
};

const TTL_MS = 2 * 60 * 1000;
let cache: { at: number; data: KpiDampakSaya } | null = null;

export async function getKpiDampakSaya(force = false): Promise<KpiDampakSaya> {
	if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
	try {
		const res = await fetch('/api/ess/kpi-dampak', { headers: { Authorization: `Bearer ${await getIdToken()}` } });
		const data = (await res.json().catch(() => null)) as KpiDampakSaya | null;
		if (!res.ok || !data) return { available: false, reason: `HTTP ${res.status}` };
		if (data.available) cache = { at: Date.now(), data };
		return data;
	} catch (e: any) {
		return { available: false, reason: e?.message || 'Gagal memuat' };
	}
}

export function formatRp(n: number): string {
	const v = Math.round(Number(n) || 0);
	return `${v < 0 ? '−' : v > 0 ? '+' : ''}Rp${Math.abs(v).toLocaleString('id-ID')}`;
}
