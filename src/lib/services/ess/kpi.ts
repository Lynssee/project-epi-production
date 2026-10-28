// src/lib/services/ess/kpi.ts
// Client-side service ESS KPI — selalu lewat /api/ess/kpi.

import { auth } from '$lib/firebase';

export interface KpiTarget {
	id: string;
	name: string;
	weight: number;
	target: number;
	achievement: number;
	metricType: string;
	unit: string;
}

export interface KpiActionItem {
	aksi: string;
	prioritas: 'high' | 'medium' | 'low';
	deadline_minggu?: number;
}

export interface KpiDetailBreakdownItem {
	nama: string;
	kategori: string;
	bobot: number;
	skor: number | null;
	terukur: boolean;
	catatan?: string | null;
}

export interface KpiDetailKategori {
	skor: number | null;
	bobotTerukur: number;
	bobotTotal: number;
	cakupanPct: number;
	breakdown: KpiDetailBreakdownItem[];
}

export interface KpiRecord {
	id: string;
	tipe: string;
	periode: string;
	tahun: number | null;
	status: string;
	targets: KpiTarget[];
	total_skor: number | null;
	skor_pelatihan: number | null;
	catatan: string | null;
	kpi_period_id: string | null;
	cutoff_status?: string | null;
	tanggal_rilis?: string | null;
	ai_recommendation?: string | null;
	ai_action_items?: KpiActionItem[];
	ai_risk_flags?: string[];
	ai_generated_at?: string | null;
	// General vs Spesifik v2 (Fase 3.3)
	skor_general?: number | null;
	skor_spesifik?: number | null;
	skor_komposit?: number | null;
	bobot_general_pct?: number | null;
	bobot_spesifik_pct?: number | null;
	detail_general?: KpiDetailKategori | null;
	detail_spesifik?: KpiDetailKategori | null;
	// L1 (bonus, General vs Spesifik v2) — peringkat anonim dalam departemen
	peringkat_departemen?: number | null;
	total_di_departemen?: number | null;
}

export interface KpiTrendPoint {
	periode: string;
	tahun: number | null;
	total_skor: number | null;
}

export interface LiveKpiTarget {
	name: string;
	achievement: number;
	target: number;
	unit: string;
}

export interface LiveKpiRecord {
	id: string;
	periode: string;
	tahun: number | null;
	status: string;
	skor_objektif: number | null;
	targets: LiveKpiTarget[];
}

export interface KriteriaItem {
	name: string;
	weight: number;
	score: number;
	notes: string;
}

export interface KpiReview {
	id: string;
	scorecard_id: string;
	penilai_tipe: string;
	kriteria: KriteriaItem[];
	total_nilai: number | null;
	komentar: string | null;
	status: string;
}

export interface KpiNotification {
	id: number;
	title: string;
	message: string;
	action_url: string | null;
	read: boolean;
	created_at: string;
}

async function getIdToken(): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return user.getIdToken();
}

async function parseErrorMessage(res: Response): Promise<string> {
	try {
		const data = await res.json();
		return data?.message || `Gagal (${res.status})`;
	} catch {
		return `Gagal (${res.status})`;
	}
}

export async function getKpiList(): Promise<{
	kpiList: KpiRecord[];
	pendingList: KpiRecord[];
	liveKpiList: LiveKpiRecord[];
	selfReviews: KpiReview[];
	defaultKriteria: KriteriaItem[];
	notifications: KpiNotification[];
	trend: KpiTrendPoint[];
}> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/kpi', { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

/** Tren skor 6 periode terakhir — sudah ikut dibawa oleh getKpiList(), fungsi ini hanya alias tipis. */
export async function fetchMyKpiTrend(): Promise<KpiTrendPoint[]> {
	const { trend } = await getKpiList();
	return trend;
}

export async function submitSelfAssessment(
	scorecardId: string,
	kriteria: KriteriaItem[],
	komentar: string
): Promise<{ review: KpiReview }> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/kpi', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ scorecardId, kriteria, komentar })
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}
