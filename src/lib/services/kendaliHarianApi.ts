// src/lib/services/kendaliHarianApi.ts
// Fase 4 (Penajaman KPI & Drilldown Detail Dept) — klien data mentah Kartu Kendali Harian (tanpa nominal rupiah).
// Satu panggilan untuk 3 kartu; cache modul 2 menit per proyek (hemat kuota — kartu dibuka-tutup tanpa fetch ulang).
import { getIdToken } from './secureDirectus';
import type { LpjRowRaw } from '$lib/utils/kendaliHarian';
import type { SCurvePoint } from '$lib/utils/fieldSCurve';

export type KendaliHarianRaw =
	| { applicable: false; reason?: string; generated_at: string }
	| {
			applicable: true;
			today: string;
			startYmd: string | null;
			calendarDays: number;
			offWeekdays: number[];
			show: { calendar: boolean; lpj: boolean; scurve: boolean };
			reportDates: string[] | null;
			reportsFailed: boolean;
			lpj: LpjRowRaw[] | null;
			lpjFailed: boolean;
			lpjGraceDays: number;
			scurve: { baseline: SCurvePoint[] | null; actual: Array<{ d: string; p: number }>; hasSubtasks: boolean; tolerancePct: number } | null;
			warnings: string[];
			generated_at: string;
	  };

const TTL_MS = 120_000;
const cache = new Map<string, { at: number; promise: Promise<KendaliHarianRaw> }>();

export function loadKendaliHarian(projectId: number | string, force = false): Promise<KendaliHarianRaw> {
	const key = String(projectId);
	const hit = cache.get(key);
	if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.promise;
	const promise = (async () => {
		const token = await getIdToken();
		const res = await fetch(`/api/proyek/${encodeURIComponent(key)}/kendali-harian`, {
			headers: { Authorization: `Bearer ${token}` }
		});
		if (!res.ok) {
			const err = new Error(`HTTP ${res.status}`) as Error & { status?: number };
			err.status = res.status;
			throw err;
		}
		const body = await res.json();
		if (!body?.success) throw new Error(body?.error || 'Gagal memuat kartu kendali harian');
		return body.data as KendaliHarianRaw;
	})();
	cache.set(key, { at: Date.now(), promise });
	// Jangan cache kegagalan.
	promise.catch(() => {
		if (cache.get(key)?.promise === promise) cache.delete(key);
	});
	return promise;
}
