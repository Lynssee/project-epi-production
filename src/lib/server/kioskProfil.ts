// src/lib/server/kioskProfil.ts
// SERVER-ONLY. Pembaca setelan profil kiosk gudang — system_settings `inventory.kiosk.profil_gudang` /
// `inventory.kiosk.profil_default` (pola setelan inventory yang sudah ada + panel edit di erp-epi
// /settings/inventory; BUKAN app_settings — dua sistem settings terpisah). Default di kode; cache 5 menit.
// Komponen TIDAK query Directus sendiri untuk setelan ini — lewat modul ini. F4-C (21 Sep 2026).

import { directusServerJson } from '$lib/server/directus';
import { isProfil, parseProfilMap, resolveProfil, type ProfilKiosk } from '$lib/kiosk/profilGudang';

const CACHE_TTL_MS = 300_000;
let cache: { at: number; map: Record<string, ProfilKiosk>; def: ProfilKiosk | null } | null = null;

async function loadSettings() {
	if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache;
	let map: Record<string, ProfilKiosk> = {};
	let def: ProfilKiosk | null = null;
	try {
		const res = await directusServerJson<{ data: Array<{ setting_key: string; setting_value: string }> }>(
			`/items/system_settings?filter[setting_key][_in]=inventory.kiosk.profil_gudang,inventory.kiosk.profil_default&fields=setting_key,setting_value&limit=-1`
		);
		for (const row of res?.data || []) {
			if (row.setting_key === 'inventory.kiosk.profil_gudang') map = parseProfilMap(row.setting_value);
			if (row.setting_key === 'inventory.kiosk.profil_default' && isProfil(row.setting_value)) def = row.setting_value;
		}
	} catch (err) {
		// Aturan #1: jangan telan diam-diam. Aman-mundur (semua menu), tapi catat.
		console.error('[kioskProfil] gagal baca system_settings inventory.kiosk.profil_*, semua menu ditampilkan:', err);
	}
	cache = { at: Date.now(), map, def };
	return cache;
}

export interface TerminalGudangOption {
	id: number;
	nama: string;
	jenis: string | null;
	profil: ProfilKiosk | null;
}

/**
 * Lokasi yang bisa dipilih sebagai tempat terminal: gudang utama/produksi aktif; dengan `includeZona`
 * juga zona aktif (mis. "Bojongkulur › Gudang Raw Material 1") — satu pabrik bisa punya zona RM dan FG
 * sekaligus, jadi profil harus bisa dipetakan sampai tingkat zona. Untuk tujuan transfer JANGAN sertakan zona.
 */
export async function listTerminalGudang(opts: { includeZona?: boolean } = {}): Promise<TerminalGudangOption[]> {
	const { map, def } = await loadSettings();
	const jenis = opts.includeZona ? 'gudang_utama,gudang_produksi,zona' : 'gudang_utama,gudang_produksi';
	const res = await directusServerJson<{ data: any[] }>(
		`/items/gudang?filter[jenis][_in]=${jenis}&filter[is_active][_eq]=true&fields=id,nama_gudang,jenis,parent_gudang_id&sort=nama_gudang&limit=-1`
	);
	const rows = res?.data || [];
	const parentIds = [...new Set(rows.map((g) => (g.parent_gudang_id && typeof g.parent_gudang_id === 'object' ? g.parent_gudang_id.id : g.parent_gudang_id)).filter((x) => x != null))];
	const parentName = new Map<number, string>();
	if (parentIds.length) {
		const pr = await directusServerJson<{ data: any[] }>(`/items/gudang?filter[id][_in]=${parentIds.join(',')}&fields=id,nama_gudang&limit=-1`);
		for (const g of pr?.data || []) parentName.set(g.id, g.nama_gudang);
	}
	const out = rows.map((g) => {
		const pid = g.parent_gudang_id && typeof g.parent_gudang_id === 'object' ? g.parent_gudang_id.id : g.parent_gudang_id;
		const nama = g.jenis === 'zona' && pid != null && parentName.get(pid) ? `${parentName.get(pid)} › ${g.nama_gudang}` : g.nama_gudang;
		return { id: g.id, nama, jenis: g.jenis ?? null, profil: resolveProfil(map, g.id, pid != null ? [pid] : [], def) };
	});
	return out.sort((x, y) => x.nama.localeCompare(y.nama, 'id'));
}

/** Profil satu gudang (naik ke leluhur bila perlu). null = belum dipetakan → tampil semua menu. */
export async function profilForGudang(gudangId: number): Promise<ProfilKiosk | null> {
	const { map, def } = await loadSettings();
	const ancestors: number[] = [];
	let cur: number | null = gudangId;
	for (let i = 0; i < 6 && cur != null; i++) {
		const res: { data: { parent_gudang_id: number | { id: number } | null } | null } = await directusServerJson(`/items/gudang/${cur}?fields=parent_gudang_id`);
		const p = res?.data?.parent_gudang_id;
		cur = p == null ? null : typeof p === 'object' ? p.id : p;
		if (cur != null) ancestors.push(cur);
		if (map[String(gudangId)] || (cur != null && map[String(cur)])) break;
	}
	return resolveProfil(map, gudangId, ancestors, def);
}
