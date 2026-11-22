// src/lib/server/sopContext.ts
// SERVER-ONLY. Membaca konteks "Panduan, SOP & Gate" per tab (app_settings 'project' / 'sop_context_map', diatur di dashboard admin).
// Hemat kuota: cache setelan 5 menit + cache katalog (alur & gate) per kombinasi 5 menit; query dipisah per koleksi (aturan Directus).
import { directusServerJson } from '$lib/server/directus';
import { normalizeStored, resolveContext } from '$lib/utils/sopContext';

const TTL = 5 * 60 * 1000;
let settingCache: { at: number; stored: Record<string, unknown> } | null = null;
const catalogCache = new Map<string, { at: number; flows: any[]; gates: any[] }>();

async function getStored(): Promise<Record<string, unknown>> {
	const now = Date.now();
	if (settingCache && now - settingCache.at < TTL) return settingCache.stored;
	try {
		const res = await directusServerJson<{ data: any[] }>(
			'/items/app_settings?filter[module][_eq]=project&filter[setting_key][_eq]=sop_context_map&fields=setting_value&limit=1'
		);
		const stored = normalizeStored(res?.data?.[0]?.setting_value);
		settingCache = { at: now, stored };
		return stored;
	} catch (e: any) {
		console.error('[sopContext] gagal membaca app_settings, memakai bawaan:', e?.message || e);
		return {};
	}
}

const inList = (a: string[]) => a.map(encodeURIComponent).join(',');

export async function getViewContext(key: string) {
	const stored = await getStored();
	const ctx = resolveContext(stored, key);
	const ck = `${ctx.sops.join(',')}|${ctx.gates.join(',')}`;
	const now = Date.now();
	let cat = catalogCache.get(ck);
	if (!cat || now - cat.at >= TTL) {
		let flows: any[] = [];
		let gates: any[] = [];
		let ok = true;
		try {
			if (ctx.sops.length) flows = (await directusServerJson<{ data: any[] }>(`/items/process_guidance_flows?filter[sop_code][_in]=${inList(ctx.sops)}&filter[status][_eq]=published&fields=sop_code,flow_key,title&limit=-1`))?.data || [];
		} catch (e: any) { ok = false; console.error('[sopContext] gagal membaca alur:', e?.message || e); }
		try {
			if (ctx.gates.length) gates = (await directusServerJson<{ data: any[] }>(`/items/gate_definitions?filter[gate_key][_in]=${inList(ctx.gates)}&filter[is_active][_eq]=true&fields=gate_key,nama,hint,default_mode&limit=-1`))?.data || [];
		} catch (e: any) { ok = false; console.error('[sopContext] gagal membaca gate:', e?.message || e); }
		cat = { at: now, flows, gates };
		if (ok) catalogCache.set(ck, cat);
	}
	const fMap = new Map(cat.flows.map((f) => [f.sop_code, f]));
	const gMap = new Map(cat.gates.map((g) => [g.gate_key, g]));
	// Lapangan hanya menampilkan SOP TERBIT & gate AKTIF (draf/nonaktif disembunyikan — bukan untuk user lapangan).
	return {
		key,
		sumber: ctx.sumber,
		catatan: ctx.catatan,
		sops: ctx.sops.filter((c) => fMap.has(c)).map((c) => ({ code: c, flow_key: fMap.get(c).flow_key, title: fMap.get(c).title })),
		gates: ctx.gates.filter((k) => gMap.has(k)).map((k) => ({ key: k, nama: gMap.get(k).nama || k, hint: gMap.get(k).hint || '', mode: gMap.get(k).default_mode || null }))
	};
}
