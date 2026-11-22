// src/lib/server/plKitFieldLoader.ts
// Bahan Kit Standar untuk form Packing List lapangan (Rencana Keyakinan Permintaan PL, Fase 2). Hanya baca; informatif —
// penegakan resmi oleh gate G_PKL_KIT_LENGKAP di ERP (mode shadow/soft/hard diatur Superadmin). Setiap relasi di-fetch terpisah
// (aturan #2). Gagal baca ⇒ field kosong + log (tidak ditelan diam-diam); form tetap berfungsi tanpa kartu kit.
// Definisi kit = app_settings module 'project' key `pkl_kit.definitions` (JSON) atau KIT_DEFAULTS (salinan kontrak erp-epi).
import { KIT_DEFAULTS, sanitizeKits, pickKitsForProject } from '$lib/shared/plKit';

type Fetcher = (url: string) => Promise<any>;
const COMMITTED = ['approved', 'active', 'picking', 'packed', 'dispatched', 'shipped', 'delivered', 'completed', 'needs_security_check', 'partial'];
const idOf = (v: any) => (v == null ? null : String(typeof v === 'object' ? v?.id : v));
const TTL_MS = 5 * 60 * 1000;
let defCache: { at: number; kits: any[] } | null = null;

async function loadDefs(dx: Fetcher) {
	if (defCache && Date.now() - defCache.at < TTL_MS) return defCache.kits;
	let kits: any[] = sanitizeKits(KIT_DEFAULTS);
	try {
		const r = await dx(`/items/app_settings?filter[module][_eq]=project&filter[setting_key][_eq]=pkl_kit.definitions&fields=setting_value&limit=1`);
		let raw = r?.data?.[0]?.setting_value;
		if (typeof raw === 'string' && raw.trim()) { try { raw = JSON.parse(raw); } catch { raw = undefined; } }
		if (Array.isArray(raw)) kits = sanitizeKits(raw);
	} catch (e: any) {
		console.warn('[plKitFieldLoader] gagal baca definisi kit — memakai bawaan:', e?.message || e);
	}
	defCache = { at: Date.now(), kits };
	return kits;
}

/** alwaysSources: tetap muat nama barang komit/site walau tak ada kit berlaku (dipakai kartu Set Produk & Equipment). */
export async function loadFieldKit(projectId: string | number, dx: Fetcher, opts: { alwaysSources?: boolean } = {}) {
	const pid = encodeURIComponent(String(projectId));
	const [defs, proj] = await Promise.all([
		loadDefs(dx),
		dx(`/items/projects/${pid}?fields=id,jenis_project,hse_work_types`).then((r: any) => r?.data || null).catch((e: any) => { console.warn(`[plKitFieldLoader] baca proyek ${projectId} gagal:`, e?.message || e); return null; })
	]);
	if (!proj) return { kits: [], committed: [] as string[], site: [] as string[] };
	let work = proj.hse_work_types;
	if (typeof work === 'string') { try { work = JSON.parse(work); } catch { work = work.split(','); } }
	const kits = pickKitsForProject(defs, { jenis_project: proj.jenis_project || '', hse_work_types: Array.isArray(work) ? work : [] });
	if (!kits.length && !opts.alwaysSources) return { kits: [], committed: [], site: [] };

	const committedIds: string[] = await dx(`/items/packing_list?filter[project_id][_eq]=${pid}&filter[status][_in]=${COMMITTED.join(',')}&fields=id&limit=-1`)
		.then((r: any) => (r?.data || []).map((p: any) => String(p.id))).catch((e: any) => { console.warn('[plKitFieldLoader] baca PL komit gagal:', e?.message || e); return []; });
	const committed: string[] = committedIds.length
		? await dx(`/items/packing_list_items?filter[packing_list_id][_in]=${committedIds.join(',')}&fields=nama_barang&limit=-1`)
			.then((r: any) => (r?.data || []).map((i: any) => i.nama_barang).filter(Boolean)).catch((e: any) => { console.warn('[plKitFieldLoader] baca item komit gagal:', e?.message || e); return []; })
		: [];
	const balances: any[] = await dx(`/items/project_stock_balance?filter[project_id][_eq]=${pid}&filter[qty_on_hand][_gt]=0&fields=item_id&limit=-1`)
		.then((r: any) => r?.data || []).catch((e: any) => { console.warn('[plKitFieldLoader] baca stok site gagal:', e?.message || e); return []; });
	const ids = [...new Set(balances.map((b) => idOf(b.item_id)).filter(Boolean))];
	const site: string[] = ids.length
		? await dx(`/items/identitas_barang?filter[id][_in]=${ids.join(',')}&fields=nama_barang_lengkap&limit=-1`)
			.then((r: any) => (r?.data || []).map((m: any) => m.nama_barang_lengkap).filter(Boolean)).catch((e: any) => { console.warn('[plKitFieldLoader] baca master stok site gagal:', e?.message || e); return []; })
		: [];
	return { kits, committed, site };
}
