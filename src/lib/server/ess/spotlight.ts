// src/lib/server/ess/spotlight.ts
// Sisi-baca Kartu Kebanggaan Proyek (Fase 5) untuk aplikasi lapangan: Wall of Belonging & slideshow Kiosk. Salinan setia (subset) dari
// erp-epi/src/lib/utils/cultureSpotlight.js + spotlightServer.js — ubah keduanya bersamaan. Cache 60 dtk; skema belum ada → [] (dilog).

import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';

const FIELDS = ['id', 'project_id', 'judul', 'ringkasan', 'pemimpin_nama', 'kru_nama', 'foto', 'status', 'tampil_dari', 'tampil_sampai'];
const TTL_MS = 60_000;
let cache: { at: number; value: SpotlightItem[] } | null = null;

export interface SpotlightItem {
	id: number;
	judul: string;
	ringkasan: string;
	pemimpin_nama: string | null;
	kru_nama: string[];
	foto_id: string | null;
}

const ymd = (v: unknown): string | null => (v ? String(v).slice(0, 10) : null);

export function normalizeKru(value: unknown): string[] {
	let v: any = value;
	if (typeof v === 'string') {
		const t = v.trim();
		if (t.startsWith('[')) {
			try {
				v = JSON.parse(t);
			} catch {
				v = [t];
			}
		} else v = t ? t.split(/\r?\n|,/) : [];
	}
	return Array.isArray(v) ? v.map((s) => String(s ?? '').trim()).filter(Boolean).slice(0, 30) : [];
}

export const fileId = (v: any): string | null => (v && typeof v === 'object' ? v.id ?? null : v || null);

export function isTayang(row: any, today: string): boolean {
	if (!row || row.status !== 'tayang') return false;
	const dari = ymd(row.tampil_dari);
	const sampai = ymd(row.tampil_sampai);
	if (dari && today < dari) return false;
	if (sampai && today > sampai) return false;
	return true;
}

export function toWallItem(row: any): SpotlightItem {
	return {
		id: row.id,
		judul: String(row.judul ?? ''),
		ringkasan: String(row.ringkasan ?? ''),
		pemimpin_nama: row.pemimpin_nama ? String(row.pemimpin_nama) : null,
		kru_nama: normalizeKru(row.kru_nama),
		foto_id: fileId(row.foto)
	};
}

export async function loadSpotlightTayang(): Promise<SpotlightItem[]> {
	if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
	let value: SpotlightItem[] = [];
	try {
		const today = todayJakarta();
		const res = await directusServerJson<{ data: any[] }>(
			`/items/culture_spotlight?filter[status][_eq]=tayang&fields=${FIELDS.join(',')}&sort=-tampil_dari,-id&limit=20`
		);
		value = (res?.data || []).filter((r) => isTayang(r, today)).map(toWallItem);
	} catch (e) {
		console.warn('[spotlight] gagal memuat spotlight tayang (skema fase 5 belum diterapkan?):', (e as Error)?.message);
	}
	cache = { at: Date.now(), value };
	return value;
}
