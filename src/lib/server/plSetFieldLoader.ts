// src/lib/server/plSetFieldLoader.ts
// Aturan Set Produk & Set Equipment untuk form lapangan (Rencana Product Pairing, Fase 3). Hanya baca; informatif —
// penegakan resmi oleh gate G_PKL_PRODUCT_SET / G_PKL_EQUIP_SET di ERP (mode diatur Superadmin). Satu query untuk dua kunci, cache 5 menit.
// Gagal baca ⇒ aturan bawaan + log (tidak ditelan diam-diam).
import { PRODUCT_RULE_DEFAULTS, EQUIPMENT_RULE_DEFAULTS, sanitizeProductRules, sanitizeEquipmentRules } from '$lib/shared/plSet';

type Fetcher = (url: string) => Promise<any>;
const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; value: { product: any[]; equipment: any[] } } | null = null;

export function resetSetRulesCache() { cache = null; }

function pick(rows: any[], key: string, sanitize: (x: any) => any[], defaults: any) {
	let raw = rows.find((r) => r?.setting_key === key)?.setting_value;
	if (typeof raw === 'string' && raw.trim()) { try { raw = JSON.parse(raw); } catch { raw = undefined; } }
	return Array.isArray(raw) ? sanitize(raw) : sanitize(defaults); // [] = admin sengaja menonaktifkan semua
}

export async function loadFieldSetRules(dx: Fetcher) {
	if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
	let rows: any[] = [];
	try {
		const r = await dx(`/items/app_settings?filter[module][_eq]=project&filter[setting_key][_in]=pkl_set.product_rules,pkl_set.equipment_rules&fields=setting_key,setting_value&limit=5`);
		rows = r?.data || [];
	} catch (e: any) {
		console.warn('[plSetFieldLoader] gagal baca aturan set — memakai bawaan:', e?.message || e);
	}
	const value = {
		product: pick(rows, 'pkl_set.product_rules', sanitizeProductRules, PRODUCT_RULE_DEFAULTS),
		equipment: pick(rows, 'pkl_set.equipment_rules', sanitizeEquipmentRules, EQUIPMENT_RULE_DEFAULTS)
	};
	cache = { at: Date.now(), value };
	return value;
}
