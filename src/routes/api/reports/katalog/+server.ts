// src/routes/api/reports/katalog/+server.ts
// Report Center Fase 6 — daftar laporan untuk aplikasi LAPANGAN ("Laporan Saya") + hitungan unduhan 90 hari.
// Sumber: koleksi Directus `report_catalog` (app = lapangan | both, aktif). Koleksi belum ada/kosong/gagal ⇒ bibit lokal.
// Hitungan diambil dari admin erp-epi (/api/reports/stats?scope=counts) — fail-soft (tanpa hitungan bila gagal).
// Cache in-memory 5 menit; fetch dipisah (katalog, lalu hitungan). Tidak pernah 500.

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';
import { LAPORAN_SAYA_FALLBACK, type LaporanSayaItem } from '$lib/data/laporanSayaFallback';

const TTL_MS = 5 * 60_000;
let catalogCache: { at: number; items: LaporanSayaItem[]; source: 'directus' | 'seed' } | null = null;

const FIELDS = 'key,title,department,level,source,route_template,required_permission,hint,sensitive,sort';

async function loadCatalog() {
	if (catalogCache && Date.now() - catalogCache.at < TTL_MS) return catalogCache;
	let items: LaporanSayaItem[] = [];
	let source: 'directus' | 'seed' = 'seed';
	try {
		const q = `/items/report_catalog?fields=${FIELDS}&filter[is_active][_eq]=true&filter[app][_in]=lapangan,both&sort=sort,title&limit=-1`;
		const rows = (await directusServerJson<{ data?: LaporanSayaItem[] }>(q))?.data || [];
		if (rows.length) {
			items = rows;
			source = 'directus';
		}
	} catch (e: any) {
		console.warn('[reports/katalog] katalog Directus tidak tersedia, pakai bibit lokal:', e?.message);
	}
	if (!items.length) items = LAPORAN_SAYA_FALLBACK;
	catalogCache = { at: Date.now(), items, source };
	return catalogCache;
}

async function loadCounts(authHeader: string): Promise<Record<string, number>> {
	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) return {};
	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/reports/stats?scope=counts&days=90`, {
			headers: { Authorization: authHeader },
			signal: AbortSignal.timeout(6000)
		});
		if (!res.ok) return {};
		return (await res.json())?.counts || {};
	} catch (e: any) {
		console.warn('[reports/katalog] hitungan tidak tersedia:', e?.message);
		return {};
	}
}

export async function GET(event: RequestEvent) {
	await requireUser(event);
	const [cat, counts] = await Promise.all([loadCatalog(), loadCounts(event.request.headers.get('authorization') || '')]);
	return json({ source: cat.source, items: cat.items, counts });
}
