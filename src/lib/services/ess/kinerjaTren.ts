// src/lib/services/ess/kinerjaTren.ts
// Klien "Tren Kinerja Saya" (matriks skor pribadi) & mini-matriks Tim Proyek. Cache memori 2 menit per kombinasi parameter
// (hemat kuota lapangan). Tidak pernah melempar: gagal -> { available:false }.
import { getIdToken } from '$lib/services/secureDirectus';

export type TrenCadence = 'bulanan' | 'triwulan' | 'tahunan';
export type TimCadence = 'mingguan' | 'bulanan';

export interface TrenBucket { key: string; label: string; fullLabel: string }
export interface TrenCell { score: number | null; status: string; notes: string | null }
export interface TrenIndikator {
	key: string;
	name: string;
	weight: number | null;
	cells: Record<string, { value: number | null; achievement: number | null; status: string }>;
	avgAchievement: number | null;
}
export interface KinerjaTren {
	available: boolean;
	reason?: string;
	nama?: string | null;
	cadence?: TrenCadence;
	year?: number;
	buckets?: TrenBucket[];
	thresholds?: { onTarget: number; warning: number };
	cells?: Record<string, TrenCell>;
	summary?: { avgScore: number | null; scoreCount: number; delta: number | null; trend: string } | null;
	indicators?: TrenIndikator[];
	generatedAt?: string;
}

export interface TimTrenAnggota {
	manpower_id: number;
	nama: string;
	jabatan: string;
	cells: Record<string, number | null>;
	avgScore: number | null;
	belumDinilaiPeriodeIni: boolean;
}
export interface TimTren {
	available: boolean;
	reason?: string;
	adalahLeader?: boolean;
	cadence?: TimCadence;
	thresholds?: { onTarget: number; warning: number };
	buckets?: TrenBucket[];
	bucketBerjalan?: string;
	proyek?: { project_id: number; nama: string; anggota: TimTrenAnggota[] }[];
}

const TTL_MS = 2 * 60 * 1000;
const cache = new Map<string, { at: number; data: unknown }>();

async function getCached<T extends { available: boolean }>(url: string, force: boolean): Promise<T> {
	const hit = cache.get(url);
	if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.data as T;
	try {
		const res = await fetch(url, { headers: { Authorization: `Bearer ${await getIdToken()}` } });
		const data = (await res.json().catch(() => null)) as T | null;
		if (!res.ok || !data) return { available: false, reason: `HTTP ${res.status}` } as unknown as T;
		if (data.available) cache.set(url, { at: Date.now(), data });
		return data;
	} catch (e: any) {
		return { available: false, reason: e?.message || 'Gagal memuat' } as unknown as T;
	}
}

export function getKinerjaTren(cadence: TrenCadence = 'bulanan', year?: number, force = false): Promise<KinerjaTren> {
	const p = new URLSearchParams({ cadence });
	if (year) p.set('year', String(year));
	return getCached<KinerjaTren>(`/api/ess/kinerja-tren?${p}`, force);
}

export function getTimTren(cadence: TimCadence = 'mingguan', year?: number, month?: number, force = false): Promise<TimTren> {
	const p = new URLSearchParams({ cadence });
	if (year) p.set('year', String(year));
	if (month) p.set('month', String(month));
	return getCached<TimTren>(`/api/ess/tim-proyek-tren?${p}`, force);
}

/** Warna sel mini-matriks menurut ambang dari server (bukan angka tetap). */
export function toneClass(score: number | null | undefined, thr?: { onTarget: number; warning: number }): string {
	if (score == null) return 'bg-slate-100 text-slate-400';
	const t = thr || { onTarget: 85, warning: 65 };
	if (score >= t.onTarget) return 'bg-emerald-100 text-emerald-700';
	if (score >= t.warning) return 'bg-amber-100 text-amber-700';
	return 'bg-red-100 text-red-700';
}
