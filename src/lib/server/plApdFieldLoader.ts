// src/lib/server/plApdFieldLoader.ts
// Bahan kartu "APD Tim" form Packing List lapangan (Rencana Keyakinan Permintaan PL, Fase 3). Hanya baca; informatif — penegakan resmi oleh
// gate G_PKL_APD_SIAP di ERP. Kecukupan JUMLAH berbasis penugasan manpower aktif × aturan APD per jabatan (bukan catatan per orang).
// Aturan = app_settings module 'project' key `pkl_apd.requirements` atau APD_DEFAULTS (salinan kontrak erp-epi). Setiap relasi di-fetch
// terpisah (aturan #2); gagal baca dilog (tidak ditelan) dan kartu disembunyikan.
import { APD_DEFAULTS, sanitizeApdConfig, computeApdNeed } from '$lib/shared/plApd';

type Fetcher = (url: string) => Promise<any>;
const COMMITTED = ['approved', 'active', 'picking', 'packed', 'dispatched', 'shipped', 'delivered', 'completed', 'needs_security_check', 'partial'];
const idOf = (v: any) => (v == null ? null : String(typeof v === 'object' ? v?.id : v));
const TTL_MS = 5 * 60 * 1000;
let cfgCache: { at: number; cfg: any } | null = null;

export function resetApdFieldCache() { cfgCache = null; }

async function loadCfg(dx: Fetcher) {
	if (cfgCache && Date.now() - cfgCache.at < TTL_MS) return cfgCache.cfg;
	let cfg: any = sanitizeApdConfig(APD_DEFAULTS);
	try {
		const r = await dx(`/items/app_settings?filter[module][_eq]=project&filter[setting_key][_eq]=pkl_apd.requirements&fields=setting_value&limit=1`);
		const raw = r?.data?.[0]?.setting_value;
		const c = raw ? sanitizeApdConfig(raw) : null;
		if (c) cfg = c;
	} catch (e: any) {
		console.warn('[plApdFieldLoader] gagal baca aturan APD — memakai bawaan:', e?.message || e);
	}
	cfgCache = { at: Date.now(), cfg };
	return cfg;
}

export async function loadFieldApd(projectId: string | number, dx: Fetcher) {
	const pid = encodeURIComponent(String(projectId));
	const empty = { persons: 0, need: [] as any[], min_coverage_pct: 100, committed: [] as any[], siteReceived: [] as any[] };
	const [cfg, assignments] = await Promise.all([
		loadCfg(dx),
		dx(`/items/manpower_assignment?filter[project_id][_eq]=${pid}&filter[status][_eq]=aktif&fields=manpower_id,jabatan,tanggal_selesai&limit=-1`)
			.then((r: any) => r?.data || [])
			.catch((e: any) => { console.warn(`[plApdFieldLoader] baca penugasan ${projectId} gagal:`, e?.message || e); return null; })
	]);
	if (!assignments) return empty;
	const today = new Date().toISOString().slice(0, 10);
	const active = assignments
		.filter((a: any) => !a.tanggal_selesai || String(a.tanggal_selesai).slice(0, 10) >= today)
		.map((a: any) => ({ manpower_id: idOf(a.manpower_id), jabatan: a.jabatan || '' }));
	const need = computeApdNeed(active, cfg);
	if (!need.persons) return { ...empty, min_coverage_pct: cfg.min_coverage_pct };

	const plIds: string[] = await dx(`/items/packing_list?filter[project_id][_eq]=${pid}&filter[status][_in]=${COMMITTED.join(',')}&fields=id&limit=-1`)
		.then((r: any) => (r?.data || []).map((p: any) => String(p.id)))
		.catch((e: any) => { console.warn('[plApdFieldLoader] baca PL komit gagal:', e?.message || e); return []; });
	const committed: any[] = plIds.length
		? await dx(`/items/packing_list_items?filter[packing_list_id][_in]=${plIds.join(',')}&fields=nama_barang,qty_required,unit&limit=-1`)
				.then((r: any) => (r?.data || []).map((i: any) => ({ nama_barang: i.nama_barang, qty: i.qty_required, unit: i.unit })))
				.catch((e: any) => { console.warn('[plApdFieldLoader] baca item komit gagal:', e?.message || e); return []; })
		: [];
	const balances: any[] = await dx(`/items/project_stock_balance?filter[project_id][_eq]=${pid}&filter[qty_received][_gt]=0&fields=item_id,qty_received&limit=-1`)
		.then((r: any) => r?.data || [])
		.catch((e: any) => { console.warn('[plApdFieldLoader] baca stok site gagal:', e?.message || e); return []; });
	const ids = [...new Set(balances.map((b) => idOf(b.item_id)).filter(Boolean))];
	const masters: any[] = ids.length
		? await dx(`/items/identitas_barang?filter[id][_in]=${ids.join(',')}&fields=id,nama_barang_lengkap,satuan&limit=-1`)
				.then((r: any) => r?.data || [])
				.catch((e: any) => { console.warn('[plApdFieldLoader] baca master stok site gagal:', e?.message || e); return []; })
		: [];
	const mById = new Map(masters.map((m) => [String(m.id), m]));
	const siteReceived = balances
		.map((b) => { const m = mById.get(idOf(b.item_id) as string); return m ? { nama_barang: m.nama_barang_lengkap, qty: b.qty_received, unit: m.satuan } : null; })
		.filter(Boolean);
	return { persons: need.persons, need: need.items, min_coverage_pct: cfg.min_coverage_pct, committed, siteReceived };
}
