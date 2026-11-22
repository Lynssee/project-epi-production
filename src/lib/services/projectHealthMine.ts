// src/lib/services/projectHealthMine.ts
// Klien tipis ke proxy /api/project/health-mine (→ erp-epi): Health Score proyek aktif milik user. Bearer token Firebase,
// cache modul 60 dtk (server cache 2 menit). READ-ONLY. Kegagalan DILEMPAR (widget menampilkan pesan, tidak diam-diam kosong).
import { getIdToken } from './secureDirectus';

export interface HealthPillar { score: number | null; error: string | null; terukur: number; total: number }
export interface HealthKritis { code: string; label: string; pillar: string }
/** Health SHADOW (berdampingan, bukan skor resmi): pilar Kepatuhan + band "Data Kurang". null = tidak dapat dihitung. */
export interface HealthShadow { kepatuhan: { pct: number; band: string; confidence: string; weight: number }; scoreLama: number | null; bandLama: string; scoreBaru: number | null; bandBaru: string; delta: number | null; dataKurang: boolean; catatan: string }
export interface MyProjectHealth {
	id: number;
	name: string;
	nomorPo: string;
	status: string;
	progres: number | null;
	health: { score: number | null; band: 'sehat' | 'perhatian' | 'kritis' | 'nodata'; pilarTerukur: number; pilarTotal: number };
	pillars: Record<string, HealthPillar>;
	kritis: HealthKritis[];
	shadow?: HealthShadow | null;
}
export interface MyHealthData { period: string; asOf: string | null; projects: MyProjectHealth[]; config: { bandSehat: number; bandPerhatian: number } | null; generatedAt: string }

export const PILLAR_LABELS: Record<string, string> = { manpower: 'Manpower', timeline: 'Timeline', keuangan: 'Biaya', kualitas: 'Mutu', hse: 'HSE', inventory: 'Stok' };

let cached: { at: number; promise: Promise<MyHealthData> } | null = null;

export function fetchMyProjectHealth(force = false): Promise<MyHealthData> {
	if (!force && cached && Date.now() - cached.at < 60_000) return cached.promise;
	const promise = (async () => {
		const token = await getIdToken();
		const res = await fetch(`/api/project/health-mine${force ? '?fresh=1' : ''}`, { headers: { Authorization: `Bearer ${token}` } });
		if (!res.ok) throw new Error(`Gagal memuat KPI proyek (${res.status})`);
		const j = await res.json();
		return (j?.data ?? { period: '', asOf: null, projects: [], config: null, generatedAt: '' }) as MyHealthData;
	})().catch((err) => {
		cached = null; // jangan cache kegagalan
		throw err;
	});
	cached = { at: Date.now(), promise };
	return promise;
}

/** Proyek yang perlu perhatian: kategori kritis, atau ada indikator kritis. */
export const needsAttention = (p: MyProjectHealth) => p.health.band === 'kritis' || p.kritis.length > 0;
