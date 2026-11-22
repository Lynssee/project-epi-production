// src/lib/server/driver/driverScore.ts
// Skor driver untuk portal lapangan. PORT dari erp-epi src/lib/utils/fleetDriverScore.js +
// fleetFuelAnalytics.js + fleetCompliance.js (rumus & bobot sama, supaya angka di admin = di HP driver).
// Jika rumus di erp-epi berubah, ubah di sini juga. Murni, tanpa I/O.

export const DEFAULT_WEIGHTS = { trip: 30, p2h: 30, bbm: 20, sim: 20 } as const;
export type ScoreKey = keyof typeof DEFAULT_WEIGHTS;
export const COMPONENT_LABELS: Record<ScoreKey, string> = {
	trip: 'Trip selesai',
	p2h: 'Cek kendaraan (P2H)',
	bbm: 'BBM wajar',
	sim: 'SIM berlaku'
};

const num = (v: unknown) => {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
};
const pct = (n: number) => Math.max(0, Math.min(100, Math.round(n * 10) / 10));

export function normalizeWeights(raw: unknown): Record<ScoreKey, number> {
	let obj: any = raw;
	if (typeof raw === 'string') {
		try { obj = JSON.parse(raw); } catch { obj = null; }
	}
	const out = {} as Record<ScoreKey, number>;
	let sum = 0;
	(Object.keys(DEFAULT_WEIGHTS) as ScoreKey[]).forEach((k) => {
		const n = Number(obj?.[k]);
		out[k] = Number.isFinite(n) && n >= 0 ? n : DEFAULT_WEIGHTS[k];
		sum += out[k];
	});
	return sum > 0 ? out : { ...DEFAULT_WEIGHTS };
}

export function simLevel(dateStr: string | null | undefined, warnDays = [30, 14, 7], today = new Date()): 'unknown' | 'expired' | 'critical' | 'warning' | 'ok' {
	if (!dateStr) return 'unknown';
	const target = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
	if (Number.isNaN(target.getTime())) return 'unknown';
	const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
	const days = Math.round((target.getTime() - t0.getTime()) / 86400000);
	const wd = [...warnDays].sort((a, b) => b - a);
	if (days < 0) return 'expired';
	if (days <= wd[wd.length - 1]) return 'critical';
	if (days <= wd[0]) return 'warning';
	return 'ok';
}

export interface FuelRow { id: number | string; vehicle_id: number | string; tanggal: string; liter: number; odometer: number | null }

/** ID pengisian BBM (di antara `fuel`) yang dianggap anomali — logika sama dgn analyzeFuel di admin. */
export function flaggedFuelIds(fuel: FuelRow[], baselineByVehicle: Map<string, number>, defaultKmPerL: number, tolerancePct: number): Set<string> {
	const groups = new Map<string, FuelRow[]>();
	for (const f of fuel) {
		const k = String(f.vehicle_id);
		if (!groups.has(k)) groups.set(k, []);
		groups.get(k)!.push(f);
	}
	const flagged = new Set<string>();
	const tol = Math.abs(tolerancePct) || 20;
	for (const [vid, list] of groups) {
		const base = baselineByVehicle.get(vid) || defaultKmPerL;
		const sorted = [...list].sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)) || num(a.odometer) - num(b.odometer));
		for (let i = 1; i < sorted.length; i++) {
			const p = sorted[i - 1];
			const c = sorted[i];
			if (p.odometer == null || c.odometer == null) continue;
			const jarak = num(c.odometer) - num(p.odometer);
			if (jarak <= 0) { flagged.add(String(c.id)); continue; }
			const liter = num(c.liter);
			if (liter <= 0 || base <= 0) continue;
			const dev = ((jarak / liter - base) / base) * 100;
			if (dev < -tol || dev > tol) flagged.add(String(c.id));
		}
	}
	return flagged;
}

export interface DriverScoreInput {
	trips: { status: string | null }[];
	checksCount: number;
	fuelInMonth: { id: number | string }[];
	flaggedIds: Set<string>;
	simExpiry: string | null;
	weights?: unknown;
	warnDays?: number[];
}

export function computeOwnScore(i: DriverScoreInput, today = new Date()) {
	const w = normalizeWeights(i.weights);
	const tn = i.trips.length;
	const comp: Record<ScoreKey, number | null> = {
		trip: tn ? pct((i.trips.filter((t) => t.status === 'completed').length / tn) * 100) : null,
		p2h: tn ? pct((Math.min(i.checksCount, tn) / tn) * 100) : null,
		bbm: i.fuelInMonth.length
			? pct(((i.fuelInMonth.length - i.fuelInMonth.filter((f) => i.flaggedIds.has(String(f.id))).length) / i.fuelInMonth.length) * 100)
			: null,
		sim: null
	};
	const lvl = simLevel(i.simExpiry, i.warnDays, today);
	if (lvl !== 'unknown') comp.sim = lvl === 'expired' ? 0 : lvl === 'critical' ? 50 : 100;

	let wsum = 0;
	let acc = 0;
	(Object.keys(w) as ScoreKey[]).forEach((k) => {
		const v = comp[k];
		if (v == null || w[k] <= 0) return;
		wsum += w[k];
		acc += v * w[k];
	});
	const hasActivity = comp.trip != null || comp.bbm != null;
	const score = wsum > 0 && hasActivity ? pct(acc / wsum) : null;
	const band = score == null ? 'none' : score >= 85 ? 'baik' : score >= 70 ? 'cukup' : 'rendah';
	return { score, band, components: comp, weights: w, counts: { trip: tn, p2h: i.checksCount, bbm: i.fuelInMonth.length } };
}
