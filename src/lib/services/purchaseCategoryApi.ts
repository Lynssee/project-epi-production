// src/lib/services/purchaseCategoryApi.ts
// Fase 3 (Pertajam Pengajuan Pembelian v2, 23 Agu 2026): baca-saja purchase_category_config
// untuk form lapangan (kelola kategori tetap di Admin erp-epi-1, Fase 2). Cache in-memory
// 5 menit — hemat API sesuai instruksi umum.

import directus, { handleDirectusError } from './directus';
import { readItems } from '@directus/sdk';

export interface PurchaseCategory {
	id: number;
	kode: string;
	nama: string;
	description: string | null;
	parent_id: number | null;
	icon: string | null;
	warna: string | null;
	sort: number | null;
	status: string;
	form_schema: any[] | null;
	requires_project: boolean;
	requires_attachment: boolean;
	is_non_stock_default: boolean;
	department_hint: string[] | null;
}

let _cache: PurchaseCategory[] | null = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function getCategoriesCached(): Promise<PurchaseCategory[]> {
	const now = Date.now();
	if (_cache && now - _cacheAt < CACHE_TTL_MS) return _cache;
	try {
		const rows = (await directus.request(
			readItems('purchase_category_config', {
				filter: { status: { _eq: 'active' } },
				sort: ['sort', 'id'],
				limit: -1
			})
		)) as unknown as PurchaseCategory[];
		_cache = rows;
		_cacheAt = now;
		return rows;
	} catch (error) {
		handleDirectusError(error);
		return _cache || [];
	}
}

/** Gabungkan form_schema induk + anak (kunci sama = anak menang). */
export function mergeFormSchema(parentSchema: any[] | null | undefined, childSchema: any[] | null | undefined): any[] {
	const safe = (s: any) => (Array.isArray(s) ? s : []);
	const byKey = new Map<string, any>(safe(parentSchema).map((f: any) => [f.key, f]));
	for (const f of safe(childSchema)) {
		if (f?.key) byKey.set(f.key, f);
	}
	return [...byKey.values()];
}

export function getEffectiveFormSchema(categories: PurchaseCategory[], kode: string): any[] {
	const cat = categories.find((c) => c.kode === kode);
	if (!cat) return [];
	if (!cat.parent_id) return Array.isArray(cat.form_schema) ? cat.form_schema : [];
	const parent = categories.find((c) => c.id === cat.parent_id);
	return mergeFormSchema(parent?.form_schema, cat.form_schema);
}

// "Sering dipakai" (localStorage, per-perangkat, bukan per-akun — cukup untuk shortcut UX)
const RECENT_KEY = 'procurement.pr.recentCategories';
const RECENT_MAX = 3;

export function getRecentCategoryKodes(): string[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const raw = localStorage.getItem(RECENT_KEY);
		return raw ? JSON.parse(raw) : [];
	} catch {
		return [];
	}
}

export function recordRecentCategoryKode(kode: string) {
	if (typeof localStorage === 'undefined' || !kode) return;
	try {
		const existing = getRecentCategoryKodes().filter((k) => k !== kode);
		const next = [kode, ...existing].slice(0, RECENT_MAX);
		localStorage.setItem(RECENT_KEY, JSON.stringify(next));
	} catch {
		// localStorage penuh/privat — bukan fatal, cuma shortcut UX hilang
	}
}
