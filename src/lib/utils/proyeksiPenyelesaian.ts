// src/lib/utils/proyeksiPenyelesaian.ts
// MODUL MURNI — Fase 5 (Target & Forecast): proyeksi tanggal selesai proyek dari laju progres aktual vs rencana Kurva S.
// Memakai data yang SUDAH dimuat Kartu Kendali Harian (baseline rencana + progres aktual kumulatif) — tanpa panggilan API baru, tanpa nominal rupiah.
// Metode: laju = kenaikan progres (poin %) per hari pada jendela terakhir (bawaan 14 hari); proyeksi linear ke 100%.
// Data kurang / laju ≤ 0 → status 'tidak_cukup_data' / 'stagnan' (bukan tanggal karangan).

export interface PointD { d: string; p: number }

export type ProyeksiStatus = 'selesai' | 'lebih_cepat' | 'sesuai' | 'terlambat' | 'stagnan' | 'tidak_cukup_data';

export interface ProyeksiPenyelesaian {
	status: ProyeksiStatus;
	progressNow: number | null;
	pacePerHari: number | null; // poin % / hari
	proyeksiSelesai: string | null; // YYYY-MM-DD
	rencanaSelesai: string | null; // tanggal baseline mencapai ~100%
	selisihHari: number | null; // >0 = terlambat dari rencana
	windowDays: number;
}

const DAY = 86_400_000;
const toMs = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);
const toYmd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Progres kumulatif terakhir pada/ sebelum tanggal (aktual berupa deret titik tidak harus harian). */
function valueAtOrBefore(series: PointD[], ymd: string): number | null {
	let v: number | null = null;
	for (const p of series) {
		if (p.d <= ymd) v = p.p;
		else break;
	}
	return v;
}

export function hitungProyeksiPenyelesaian(
	actual: PointD[] | null | undefined,
	baseline: PointD[] | null | undefined,
	todayYmd: string,
	opt: { windowDays?: number; toleranceDays?: number } = {}
): ProyeksiPenyelesaian {
	const windowDays = Math.max(3, opt.windowDays ?? 14);
	const tol = Math.max(0, opt.toleranceDays ?? 3);
	const act = [...(actual || [])].filter((x) => Number.isFinite(x?.p) && /^\d{4}-\d{2}-\d{2}$/.test(x?.d || '')).sort((a, b) => a.d.localeCompare(b.d));
	const base = [...(baseline || [])].filter((x) => Number.isFinite(x?.p) && /^\d{4}-\d{2}-\d{2}$/.test(x?.d || '')).sort((a, b) => a.d.localeCompare(b.d));
	const rencanaSelesai = base.length ? (base.find((x) => x.p >= 99.5)?.d ?? base[base.length - 1].d) : null;
	const empty = (status: ProyeksiStatus, now: number | null = null): ProyeksiPenyelesaian => ({ status, progressNow: now, pacePerHari: null, proyeksiSelesai: null, rencanaSelesai, selisihHari: null, windowDays });

	if (!act.length) return empty('tidak_cukup_data');
	const now = act[act.length - 1].p;
	if (now >= 99.5) return { ...empty('selesai', now), proyeksiSelesai: act[act.length - 1].d };

	const startYmd = toYmd(toMs(todayYmd) - windowDays * DAY);
	const before = valueAtOrBefore(act, startYmd);
	// Butuh titik di/ sebelum awal jendela, atau (proyek baru) titik pertama sebagai awal.
	const first = act[0];
	const startVal = before ?? (toMs(first.d) >= toMs(startYmd) ? 0 : null);
	const startDate = before != null ? startYmd : first.d;
	if (startVal == null) return empty('tidak_cukup_data', now);
	const days = Math.max(1, Math.round((toMs(todayYmd) - toMs(startDate)) / DAY));
	if (days < 7) return empty('tidak_cukup_data', now); // jendela terlalu pendek → laju tidak stabil
	const pace = (now - startVal) / days;
	if (!(pace > 0)) return { ...empty('stagnan', now), pacePerHari: Math.round(pace * 1000) / 1000 };

	const sisaHari = Math.ceil((100 - now) / pace);
	const proyeksiSelesai = toYmd(toMs(todayYmd) + sisaHari * DAY);
	const selisihHari = rencanaSelesai ? Math.round((toMs(proyeksiSelesai) - toMs(rencanaSelesai)) / DAY) : null;
	const status: ProyeksiStatus = selisihHari == null ? 'sesuai' : selisihHari > tol ? 'terlambat' : selisihHari < -tol ? 'lebih_cepat' : 'sesuai';
	return { status, progressNow: Math.round(now * 10) / 10, pacePerHari: Math.round(pace * 1000) / 1000, proyeksiSelesai, rencanaSelesai, selisihHari, windowDays };
}
