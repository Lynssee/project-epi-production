// Config loader untuk Quick Estimator — reuse fetchKalkulatorConfig() yang sudah ada
// (kalkulatorPenawaran.ts), hanya menambahkan in-memory cache TTL 10 menit supaya surveyor
// yang mengubah input berkali-kali tidak memicu fetch Directus berulang.
import { fetchKalkulatorConfig } from './kalkulatorPenawaran';
import type { QuickEstimatorRates, QuickEstimatorMultipliers } from '$lib/utils/quickEstimator';

const TTL_MS = 10 * 60 * 1000;

interface QuickEstimatorConfigCache {
	rates: QuickEstimatorRates;
	multipliers: QuickEstimatorMultipliers;
	fetchedAt: number;
}

let cache: QuickEstimatorConfigCache | null = null;

export async function getQuickEstimatorConfig(
	{ force = false }: { force?: boolean } = {}
): Promise<{ rates: QuickEstimatorRates; multipliers: QuickEstimatorMultipliers }> {
	if (!force && cache && Date.now() - cache.fetchedAt < TTL_MS) {
		return { rates: cache.rates, multipliers: cache.multipliers };
	}
	const cfg = await fetchKalkulatorConfig();
	const rates: QuickEstimatorRates = cfg.quick_estimator_rates || {};
	const multipliers: QuickEstimatorMultipliers = cfg.quick_estimator_multipliers || {};
	cache = { rates, multipliers, fetchedAt: Date.now() };
	return { rates, multipliers };
}

export function invalidateQuickEstimatorConfigCache(): void {
	cache = null;
}
