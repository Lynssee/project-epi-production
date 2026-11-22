// src/lib/services/targetProyeksiSummary.ts
// Fase 5+ (Target & Forecast KPI) — ringkasan Target & Proyeksi Skor Komposit PERUSAHAAN bulan berjalan untuk Command Center.
// Baca LANGSUNG dua koleksi Directus (pola sama dgn kapasitasSummary.ts; tanpa lintas-origin): kpi_forecast_cache (dihitung job malam di erp-epi)
// + kpi_long_term_targets (hanya target TERKUNCI yang ditampilkan). 2 query ringan, filter spesifik. Gagal / belum ada cache → null
// (halaman menampilkan pesan jujur, bukan angka kosong). Tanpa nominal rupiah.
import { secureDirectusJson } from './secureDirectus';

export interface TargetProyeksiSummary {
	label: string; // YYYY-MM bulan berjalan (WIB)
	target: number | null; // hanya bila terkunci
	targetLocked: boolean;
	forecast: number | null;
	low: number | null;
	high: number | null;
	status: 'on_track' | 'at_risk' | 'off_track' | 'unknown';
	gapPct: number | null;
	computedAt: string | null;
}

/** Label bulan berjalan dalam WIB (UTC+7), konsisten dengan horizonRange 'monthly' di erp-epi. */
export function currentMonthLabelWib(now: number = Date.now()): string {
	const d = new Date(now + 7 * 3600_000);
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function hitungStatus(target: number | null, forecast: number | null, warnPct = 80): { status: TargetProyeksiSummary['status']; gapPct: number | null } {
	if (target == null || forecast == null || !Number.isFinite(target) || !Number.isFinite(forecast) || target === 0) return { status: 'unknown', gapPct: null };
	const att = (forecast / target) * 100;
	return { status: att >= 100 ? 'on_track' : att >= warnPct ? 'at_risk' : 'off_track', gapPct: Math.round(((forecast - target) / Math.abs(target)) * 1000) / 10 };
}

const enc = (o: unknown) => encodeURIComponent(JSON.stringify(o));

export async function getTargetProyeksiSummary(now: number = Date.now()): Promise<TargetProyeksiSummary | null> {
	const label = currentMonthLabelWib(now);
	const filter = { level: { _eq: 'company' }, kpi_definition_id: { _eq: 0 }, horizon_type: { _eq: 'monthly' }, horizon_label: { _eq: label } };
	try {
		const [fc, tg] = await Promise.all([
			secureDirectusJson<{ data: any[] }>(`/items/kpi_forecast_cache?filter=${enc(filter)}&sort=-computed_at&limit=1&fields=forecast_value,confidence_low,confidence_high,computed_at`),
			secureDirectusJson<{ data: any[] }>(`/items/kpi_long_term_targets?filter=${enc(filter)}&limit=1&fields=target_value,is_locked`)
		]);
		const f = fc?.data?.[0];
		const t = tg?.data?.[0];
		if (!f && !t) return null;
		const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
		const locked = !!t?.is_locked;
		const target = locked ? num(t?.target_value) : null; // target draf atasan tidak ditampilkan di lapangan
		const forecast = num(f?.forecast_value);
		const { status, gapPct } = hitungStatus(target, forecast);
		return { label, target, targetLocked: locked, forecast, low: num(f?.confidence_low), high: num(f?.confidence_high), status, gapPct, computedAt: f?.computed_at ?? null };
	} catch (e) {
		console.error('getTargetProyeksiSummary:', e);
		return null;
	}
}
