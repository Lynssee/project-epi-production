// src/lib/server/ess/kpi.ts
// Query helper KPI karyawan (koleksi kpi_management) untuk /api/ess/kpi.

import { directusServerJson } from '$lib/server/directus';

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
	// General vs Spesifik v2 (Fase 3.3) — sama gerbang visibilitas dengan total_skor
	// (hanya terisi untuk scorecard Finalized, lihat listKpiKaryawan).
	skor_general?: number | null;
	skor_spesifik?: number | null;
	skor_komposit?: number | null;
	bobot_general_pct?: number | null;
	bobot_spesifik_pct?: number | null;
	detail_general?: KpiDetailKategori | null;
	detail_spesifik?: KpiDetailKategori | null;
	// KPI x Payroll TAJAM v2, Fase 3 — hanya terisi bila kpi_period.cutoff_status='released'
	// (lihat attachCutoffInfo + redaction di listKpiKaryawan), sejalan kebijakan kualitatif
	// tersembunyi sampai rilis (Q9, 29 Jul 2026).
	ai_recommendation?: string | null;
	ai_action_items?: KpiActionItem[];
	ai_risk_flags?: string[];
	ai_generated_at?: string | null;
	// L1 (bonus, General vs Spesifik v2) — peringkat ANONIM dalam departemen: tidak pernah
	// mengekspos nama/id karyawan lain, hanya posisi & jumlah total (lihat attachRank).
	peringkat_departemen?: number | null;
	total_di_departemen?: number | null;
}

const KPI_FIELDS = [
	'id', 'tipe', 'periode', 'tahun', 'status', 'targets', 'total_skor', 'skor_pelatihan', 'catatan', 'kpi_period_id', 'departemen',
	'ai_recommendation', 'ai_action_items', 'ai_risk_flags', 'ai_generated_at',
	// General vs Spesifik v2 (Fase 3.3)
	'skor_general', 'skor_spesifik', 'skor_komposit', 'bobot_general_pct', 'bobot_spesifik_pct', 'detail_general', 'detail_spesifik'
].join(',');

/**
 * L1 (bonus, General vs Spesifik v2) — peringkat anonim dalam departemen & periode yang sama.
 * Hanya membandingkan total_skor Finalized lain di departemen sendiri; TIDAK PERNAH mengembalikan
 * nama/id karyawan lain ke klien — hanya angka posisi & jumlah total peserta.
 */
async function attachRank(records: (KpiRecord & { departemen?: string | null })[]): Promise<KpiRecord[]> {
	const out: KpiRecord[] = [];
	for (const r of records) {
		if (!r.departemen || r.total_skor == null) {
			out.push({ ...r, peringkat_departemen: null, total_di_departemen: null });
			continue;
		}
		try {
			const query = new URLSearchParams({
				'filter[departemen][_eq]': r.departemen,
				'filter[periode][_eq]': r.periode,
				'filter[tahun][_eq]': String(r.tahun ?? ''),
				'filter[tipe][_eq]': 'Karyawan',
				'filter[status][_eq]': 'Finalized',
				fields: 'total_skor',
				limit: '-1'
			});
			const result = await directusServerJson<{ data: { total_skor: number | null }[] }>(`/items/kpi_management?${query.toString()}`);
			const skorLain = (result?.data || []).map((d) => Number(d.total_skor) || 0).filter((s) => Number.isFinite(s));
			if (skorLain.length === 0) {
				out.push({ ...r, peringkat_departemen: null, total_di_departemen: null });
				continue;
			}
			const skorSaya = Number(r.total_skor) || 0;
			const peringkat = skorLain.filter((s) => s > skorSaya).length + 1;
			out.push({ ...r, peringkat_departemen: peringkat, total_di_departemen: skorLain.length });
		} catch {
			out.push({ ...r, peringkat_departemen: null, total_di_departemen: null });
		}
	}
	return out;
}

/** Fase 10 (dashboard visual lapangan): ambil cutoff_status/tanggal_rilis kpi_period terkait
 *  supaya ESS bisa tampilkan badge "Dirilis" vs "Menunggu Rilis" — murni informatif, TIDAK
 *  mengubah gerbang visibilitas (masih Finalized-only, lihat listKpiKaryawan di bawah). */
async function attachCutoffInfo(records: KpiRecord[]): Promise<KpiRecord[]> {
	const periodIds = [...new Set(records.map((r) => r.kpi_period_id).filter((id): id is string => Boolean(id)))];
	if (periodIds.length === 0) return records;
	const query = new URLSearchParams({
		'filter[id][_in]': periodIds.join(','),
		fields: 'id,cutoff_status,tanggal_rilis'
	});
	const result = await directusServerJson<{ data: { id: string; cutoff_status: string | null; tanggal_rilis: string | null }[] }>(
		`/items/kpi_period?${query.toString()}`
	);
	const byId = new Map((result?.data || []).map((p) => [p.id, p]));
	return records.map((r) => {
		const p = r.kpi_period_id ? byId.get(r.kpi_period_id) : null;
		const cutoff_status = p?.cutoff_status || null;
		const released = cutoff_status === 'released';
		return {
			...r,
			cutoff_status,
			tanggal_rilis: p?.tanggal_rilis || null,
			// Belum released -> AI redacted, sama seperti total_skor/skor_perilaku secara kebijakan.
			ai_recommendation: released ? r.ai_recommendation ?? null : null,
			ai_action_items: released ? r.ai_action_items ?? [] : [],
			ai_risk_flags: released ? r.ai_risk_flags ?? [] : [],
			ai_generated_at: released ? r.ai_generated_at ?? null : null
		};
	});
}

export interface KpiNotification {
	id: number;
	title: string;
	message: string;
	action_url: string | null;
	read: boolean;
	created_at: string;
}

/**
 * Notifikasi personal karyawan ini terkait KPI (mis. jembatan skor proyek — lihat
 * projectKpiBridge.js/projectClosureApprovalEngine.js admin). Field karyawan_id di
 * app_notifications opsional/additive — baris lama (department-scoped saja) tidak
 * ikut terambil di sini karena karyawan_id-nya null.
 */
export async function listKpiNotifications(karyawanId: number): Promise<KpiNotification[]> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		'filter[type][_starts_with]': 'PROJECT_KPI_BRIDGE',
		fields: 'id,title,message,action_url,read,created_at',
		sort: '-created_at',
		limit: '10'
	});
	const result = await directusServerJson<{ data: KpiNotification[] }>(`/items/app_notifications?${query.toString()}`);
	return result?.data || [];
}

export interface KpiTrendPoint {
	periode: string;
	tahun: number | null;
	total_skor: number | null;
}

/**
 * KPI x Payroll TAJAM v2, Fase 3 — tren skor total N periode terakhir untuk grafik ESS.
 * Sama seperti listKpiKaryawan (Finalized-only), diurutkan lama -> baru untuk chart.
 */
export async function listKpiTrend(karyawanId: number, months = 6): Promise<KpiTrendPoint[]> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		'filter[tipe][_eq]': 'Karyawan',
		'filter[status][_eq]': 'Finalized',
		fields: 'periode,tahun,total_skor',
		sort: '-tahun,-periode',
		limit: String(months)
	});
	const result = await directusServerJson<{ data: KpiTrendPoint[] }>(`/items/kpi_management?${query.toString()}`);
	return (result?.data || []).reverse();
}

/** Hanya KPI Karyawan (bukan Departemen) berstatus Finalized yang boleh dilihat karyawan. */
export async function listKpiKaryawan(karyawanId: number): Promise<KpiRecord[]> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		'filter[tipe][_eq]': 'Karyawan',
		'filter[status][_eq]': 'Finalized',
		fields: KPI_FIELDS,
		sort: '-tahun,-periode',
		limit: '24'
	});
	const result = await directusServerJson<{ data: KpiRecord[] }>(`/items/kpi_management?${query.toString()}`);
	const withCutoff = await attachCutoffInfo(result?.data || []);
	return attachRank(withCutoff);
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

export const SELF_ASSESSMENT_KRITERIA: KriteriaItem[] = [
	{ name: 'Kinerja & Produktivitas', weight: 30, score: 0, notes: '' },
	{ name: 'Sikap & Profesionalisme', weight: 20, score: 0, notes: '' },
	{ name: 'Kehadiran & Kedisiplinan', weight: 20, score: 0, notes: '' },
	{ name: 'Kemampuan Teknis', weight: 20, score: 0, notes: '' },
	{ name: 'Kerja Tim & Komunikasi', weight: 10, score: 0, notes: '' }
];

/** KPI Karyawan yang belum Finalized — kandidat self-assessment. */
export async function listPendingKpi(karyawanId: number): Promise<KpiRecord[]> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		'filter[tipe][_eq]': 'Karyawan',
		'filter[status][_neq]': 'Finalized',
		fields: KPI_FIELDS,
		sort: '-tahun,-periode',
		limit: '12'
	});
	const result = await directusServerJson<{ data: KpiRecord[] }>(`/items/kpi_management?${query.toString()}`);
	return result?.data || [];
}

// ==================== LIVE QUANTITATIF (keputusan Q9, 29 Jul 2026) ====================
// "Karyawan lihat skor live untuk skor kuantitatif (real-time), kualitatif tetap
// tersembunyi sampai rilis." Scorecard yang BELUM Finalized boleh menampilkan
// skor_objektif + indikator yang otomatis (data_source terisi kalkulator, ditandai
// `otomatis:true` di sumber_perhitungan hasil "Hitung Otomatis" — lihat kpiEngine.js
// admin) — TAPI TIDAK total_skor/skor_perilaku/skor_potensi/catatan, karena itu
// campuran kualitatif atau murni kualitatif (review atasan/self/rekan) yang menurut
// kebijakan ini harus tetap tersembunyi sampai kpi_period.cutoff_status='released'.

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

const LIVE_KPI_FIELDS = ['id', 'periode', 'tahun', 'status', 'targets', 'skor_objektif', 'sumber_perhitungan'].join(',');

function redactToLiveView(raw: {
	id: string; periode: string; tahun: number | null; status: string;
	targets: unknown; skor_objektif: number | null; sumber_perhitungan: unknown;
}): LiveKpiRecord | null {
	const targets = (typeof raw.targets === 'string' ? JSON.parse(raw.targets || '[]') : raw.targets || []) as {
		name: string; achievement: number; target: number; unit: string;
	}[];
	const audit = (typeof raw.sumber_perhitungan === 'string' ? JSON.parse(raw.sumber_perhitungan || '[]') : raw.sumber_perhitungan || []) as {
		indikator: string; otomatis: boolean;
	}[];
	const otomatisNames = new Set(audit.filter((a) => a.otomatis).map((a) => a.indikator));
	if (otomatisNames.size === 0) return null; // belum pernah "Hitung Otomatis" — tidak ada apa pun yg aman ditampilkan live

	const liveTargets = targets
		.filter((t) => otomatisNames.has(t.name))
		.map((t) => ({ name: t.name, achievement: Number(t.achievement) || 0, target: Number(t.target) || 0, unit: t.unit || '' }));
	if (liveTargets.length === 0) return null;

	return {
		id: raw.id, periode: raw.periode, tahun: raw.tahun, status: raw.status,
		skor_objektif: raw.skor_objektif, targets: liveTargets
	};
}

/** KPI Karyawan yang masih berjalan (belum Finalized) — HANYA bagian kuantitatif. */
export async function listLiveKpiKaryawan(karyawanId: number): Promise<LiveKpiRecord[]> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		'filter[tipe][_eq]': 'Karyawan',
		'filter[status][_neq]': 'Finalized',
		fields: LIVE_KPI_FIELDS,
		sort: '-tahun,-periode',
		limit: '12'
	});
	const result = await directusServerJson<{
		data: { id: string; periode: string; tahun: number | null; status: string; targets: unknown; skor_objektif: number | null; sumber_perhitungan: unknown }[];
	}>(`/items/kpi_management?${query.toString()}`);
	return (result?.data || [])
		.map(redactToLiveView)
		.filter((r): r is LiveKpiRecord => r !== null);
}

/** Self-assessment yang sudah pernah diisi karyawan untuk sekumpulan scorecard. */
export async function listSelfReviews(scorecardIds: string[]): Promise<KpiReview[]> {
	if (scorecardIds.length === 0) return [];
	const query = new URLSearchParams({
		'filter[scorecard_id][_in]': scorecardIds.join(','),
		'filter[penilai_tipe][_eq]': 'self',
		fields: ['id', 'scorecard_id', 'penilai_tipe', 'kriteria', 'total_nilai', 'komentar', 'status'].join(',')
	});
	const result = await directusServerJson<{ data: KpiReview[] }>(`/items/kpi_review?${query.toString()}`);
	return result?.data || [];
}

function calcTotalNilai(kriteria: KriteriaItem[]): number {
	const totalWeight = kriteria.reduce((s, k) => s + (Number(k.weight) || 0), 0);
	if (totalWeight === 0) return 0;
	const weighted = kriteria.reduce((sum, k) => sum + (Number(k.score) || 0) * (Number(k.weight) || 0), 0);
	return Math.round((weighted / totalWeight) * 10) / 10;
}

/** Submit atau perbarui self-assessment karyawan untuk satu scorecard (idempotent per scorecard). */
export async function submitSelfReview(
	scorecardId: string,
	karyawanId: number,
	kriteria: KriteriaItem[],
	komentar: string
): Promise<KpiReview> {
	const existing = await listSelfReviews([scorecardId]);
	const totalNilai = calcTotalNilai(kriteria);
	const payload = {
		scorecard_id: scorecardId,
		penilai_tipe: 'self',
		penilai_karyawan_id: String(karyawanId),
		kriteria,
		total_nilai: totalNilai,
		komentar,
		status: 'Submitted'
	};

	if (existing.length > 0) {
		const result = await directusServerJson<{ data: KpiReview }>(`/items/kpi_review/${existing[0].id}`, {
			method: 'PATCH',
			body: JSON.stringify(payload)
		});
		return result.data;
	}

	const result = await directusServerJson<{ data: KpiReview }>('/items/kpi_review', {
		method: 'POST',
		body: JSON.stringify(payload)
	});
	return result.data;
}
