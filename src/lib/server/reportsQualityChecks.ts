// src/lib/server/reportsQualityChecks.ts
// ⚠️ SERVER-ONLY. R2-08 — penghubung I/O untuk aturan murni laporanKualitasRules.ts (kembar erp-epi
// src/lib/server/gates/reportsQualityChecks.js): G_LH_MUNDUR, G_LH_VOLUME_WAJAR, G_LH_FOTO_HARIAN, G_LH_POLA_DATAR.
// Ambang dari system_settings `project.laporan.disiplin`; mode tiap gate dari registry (default shadow).

import {
	parseDisiplin,
	evaluasiMundur,
	evaluasiVolumeWajar,
	evaluasiPolaDatar,
	evaluasiFotoHarian,
	type Disiplin
} from '$lib/shared/laporanKualitasRules';
import type { ExtraCheck } from './reportsBatchGate';

export const LH_MUNDUR = 'G_LH_MUNDUR';
export const LH_VOLUME_WAJAR = 'G_LH_VOLUME_WAJAR';
export const LH_FOTO_HARIAN = 'G_LH_FOTO_HARIAN';
export const LH_POLA_DATAR = 'G_LH_POLA_DATAR';
export const DISIPLIN_SETTING_KEY = 'project.laporan.disiplin';

const TTL = 5 * 60 * 1000;
let cfgCache: { at: number; value: Disiplin | null } = { at: 0, value: null };

/** Tanggal hari ini menurut WIB (UTC+7), YYYY-MM-DD. */
export function wibToday(now: Date = new Date()): string {
	return new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

async function loadCfg(fetchJson: (p: string) => Promise<any>): Promise<Disiplin> {
	if (cfgCache.value && Date.now() - cfgCache.at < TTL) return cfgCache.value;
	try {
		const r = await fetchJson(`/items/system_settings?filter[setting_key][_eq]=${DISIPLIN_SETTING_KEY}&fields=setting_value&limit=1`);
		cfgCache = { at: Date.now(), value: parseDisiplin(r?.data?.[0]?.setting_value) };
	} catch (e: any) {
		console.error('[reportsQualityChecks] setelan disiplin tak terbaca, pakai default:', e?.message || e);
		cfgCache = { at: Date.now(), value: parseDisiplin(null) };
	}
	return cfgCache.value as Disiplin;
}

export function buildQualityChecks(deps: {
	fetchJson: (path: string) => Promise<any>;
	modeFor: (gateKey: string) => () => Promise<'shadow' | 'warn' | 'soft' | 'hard'>;
	now?: Date;
}): ExtraCheck[] {
	const { fetchJson, modeFor, now = new Date() } = deps;
	const timelineCache = new Map<string, Promise<unknown>>();
	const prevCache = new Map<string, Promise<any[]>>();
	const pidOf = (el: any) => (el.project_id && typeof el.project_id === 'object' ? el.project_id.id : el.project_id);

	const timelineOf = (pid: string) => {
		if (!timelineCache.has(pid)) {
			timelineCache.set(
				pid,
				fetchJson(`/items/projects/${encodeURIComponent(pid)}?fields=id,timeline_planning`).then((r) => r?.data?.timeline_planning ?? null)
			);
		}
		return timelineCache.get(pid) as Promise<unknown>;
	};
	const prevOf = (pid: string, day: string, n: number) => {
		const key = `${pid}|${day}|${n}`;
		if (!prevCache.has(key)) {
			prevCache.set(
				key,
				fetchJson(
					`/items/reports?filter[project_id][_eq]=${encodeURIComponent(pid)}&filter[date][_lt]=${day}&filter[status][_neq]=rejected` +
						`&fields=id,date,progress&sort=-date&limit=${n}`
				).then((r) => (Array.isArray(r?.data) ? r.data : []))
			);
		}
		return prevCache.get(key) as Promise<any[]>;
	};

	return [
		{
			gateKey: LH_MUNDUR,
			label: 'Lapor tepat waktu (maks. H-2 bebas)',
			tab: 'meta',
			appliesTo: 'create',
			mode: modeFor(LH_MUNDUR),
			async run(el) {
				if (!el.date) return null;
				const cfg = await loadCfg(fetchJson);
				const r = evaluasiMundur({
					date: el.date,
					today: wibToday(now),
					alasan: el.alasan_input_admin,
					kategoriAdmin: el.kategori_alasan_admin,
					isAdmin: String(el.disubmit_sebagai || '').toLowerCase() === 'admin',
					cfg
				});
				return r ? r.message : null;
			}
		},
		{
			gateKey: LH_VOLUME_WAJAR,
			label: 'Volume harian wajar',
			tab: 'progress',
			appliesTo: 'all',
			mode: modeFor(LH_VOLUME_WAJAR),
			async run(el) {
				const pid = pidOf(el);
				if (!pid || el.progress === undefined || !el.date) return null;
				const cfg = await loadCfg(fetchJson);
				const hits = evaluasiVolumeWajar(el.progress, await timelineOf(String(pid)), el.date, cfg);
				if (!hits.length) return null;
				return `Isi volume yang dikerjakan HARI INI, bukan total. ${hits
					.slice(0, 3)
					.map((h) => `${h.nama || h.subtask_id}: ${h.nilai} > sisa ${h.sisa}`)
					.join('; ')}${hits.length > 3 ? ` (+${hits.length - 3} lainnya)` : ''}.`;
			}
		},
		{
			gateKey: LH_FOTO_HARIAN,
			label: 'Foto harian terlampir',
			tab: 'progress',
			appliesTo: 'all',
			mode: modeFor(LH_FOTO_HARIAN),
			async run(el, ctx) {
				const r = evaluasiFotoHarian(el, { isCreate: ctx.isCreate });
				return r ? r.message : null;
			}
		},
		{
			gateKey: LH_POLA_DATAR,
			label: 'Angka progres tidak datar',
			tab: 'progress',
			appliesTo: 'create',
			mode: modeFor(LH_POLA_DATAR),
			async run(el) {
				const pid = pidOf(el);
				if (!pid || el.progress === undefined || !el.date) return null;
				const cfg = await loadCfg(fetchJson);
				if (!(cfg.pola_datar_min >= 2)) return null;
				const prev = await prevOf(String(pid), String(el.date).slice(0, 10), cfg.pola_datar_min - 1);
				const hits = evaluasiPolaDatar(el.progress, prev, cfg.pola_datar_min);
				if (!hits.length) return null;
				return `Nilai harian identik ${hits[0].run}× berturut-turut pada ${hits.length} subtask (mis. ${hits[0].nilai}). Pastikan angka diukur nyata, bukan salinan.`;
			}
		}
	];
}
