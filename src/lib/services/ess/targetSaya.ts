// src/lib/services/ess/targetSaya.ts
// Klien "Target & Proyeksi Saya". Cache memori 2 menit (hemat kuota lapangan). Tidak pernah melempar: gagal -> { available:false }.
import { getIdToken } from '$lib/services/secureDirectus';

export type TargetStatus = 'on_track' | 'at_risk' | 'off_track' | 'unknown';

export interface TargetSayaHorizon {
	horizonType: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
	label: string;
	target: { target: number | null; threshold: number | null; stretch: number | null } | null;
	forecast: { value: number; low: number; high: number } | null;
	status: TargetStatus;
	gapPct: number | null;
}

export interface TargetSayaDepartmentSummary {
	available: boolean;
	department: string;
	reason?: string | null;
	series?: { label: string; value: number }[];
	projection?: { label: string; value: number; low: number; high: number }[];
	horizons?: TargetSayaHorizon[];
}

export interface TargetSaya {
	available: boolean;
	personalReady?: boolean;
	reason?: string;
	nama?: string | null;
	department?: string | null;
	series?: { label: string; value: number }[];
	projection?: { label: string; value: number; low: number; high: number }[];
	horizons?: TargetSayaHorizon[];
	departmentSummary?: TargetSayaDepartmentSummary | null;
	generatedAt?: string;
}

const TTL_MS = 2 * 60 * 1000;
let cache: { at: number; data: TargetSaya } | null = null;

export async function getTargetSaya(force = false): Promise<TargetSaya> {
	if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
	try {
		const res = await fetch('/api/ess/target-saya', { headers: { Authorization: `Bearer ${await getIdToken()}` } });
		const data = (await res.json().catch(() => null)) as TargetSaya | null;
		if (!res.ok || !data) return { available: false, reason: `HTTP ${res.status}` };
		if (data.available) cache = { at: Date.now(), data };
		return data;
	} catch (e: any) {
		return { available: false, reason: e?.message || 'Gagal memuat' };
	}
}

export const HORIZON_LABEL: Record<string, string> = { weekly: 'Minggu ini', monthly: 'Bulan ini', quarterly: 'Kuartal ini', yearly: 'Tahun ini' };

export const STATUS_TEXT: Record<TargetStatus, { t: string; c: string }> = {
	on_track: { t: 'Di jalur', c: 'bg-emerald-100 text-emerald-700' },
	at_risk: { t: 'Berisiko', c: 'bg-amber-100 text-amber-700' },
	off_track: { t: 'Perlu dikejar', c: 'bg-red-100 text-red-700' },
	unknown: { t: 'Belum ada target', c: 'bg-slate-100 text-slate-500' }
};

/** Titik polyline sparkline (viewBox 0 0 w h) dari deret history + proyeksi; null bila < 2 titik. */
export function sparkPoints(vals: number[], w = 120, h = 28): string | null {
	const v = vals.filter((x) => Number.isFinite(x));
	if (v.length < 2) return null;
	const min = Math.min(...v);
	const max = Math.max(...v);
	const span = max - min || 1;
	return v.map((y, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - 2 - ((y - min) / span) * (h - 4)).toFixed(1)}`).join(' ');
}
