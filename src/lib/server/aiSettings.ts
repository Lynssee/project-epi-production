// src/lib/server/aiSettings.ts
// SERVER-ONLY. Port TypeScript dari lib/server/aiSettings.js (erp-epi-1) — baca
// koleksi Directus `ai_settings` yang SAMA (instance dibagi kedua repo, kebanyakan
// baris target_app='both'). §7#6 (implementation_plan_asisten_ai_v2.md): MODEL/
// MAX_TOKENS/dst di gateway lapangan sebelumnya hardcode — sekarang dibaca dari sini
// supaya bisa diubah dari panel Settings > Asisten AI (admin) tanpa deploy ulang,
// dan otomatis konsisten dengan nilai yang dipakai gateway admin.
//
// Beda dari admin: lapangan TIDAK melakukan model routing (Haiku/Sonnet) — selalu
// pakai satu model (model_complex), jadi pickModelForMessage() tidak diport ke sini.

import { directusServerJson } from './directus';

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { settings: AiSettings; exp: number } | null = null;

export interface AiSettings {
	model_complex: string;
	max_tokens: number;
	max_tool_rounds: number;
	max_history: number;
	time_budget_ms: number;
	round_safety_margin_ms: number;
	request_timeout_ms: number;
	// §5A Streaming — KUNCI TERPISAH dari `streaming_enabled` admin (baris Directus
	// berbeda) supaya rollout lapangan bisa dinyalakan/dimatikan independen dari
	// admin (gateway berbeda, belum tentu sama-sama siap produksi bersamaan).
	streaming_enabled_lapangan: boolean;
}

// Fallback bila koleksi kosong/tak terjangkau — nilai sama seperti hardcode lama
// (identik dengan DEFAULTS di aiSettings.js admin, subset yang dipakai lapangan).
const DEFAULTS: AiSettings = Object.freeze({
	model_complex: 'anthropic/claude-sonnet-4.5',
	max_tokens: 1024,
	max_tool_rounds: 5,
	max_history: 20,
	time_budget_ms: 45_000,
	round_safety_margin_ms: 8_000,
	request_timeout_ms: 30_000,
	streaming_enabled_lapangan: false
});

export function sanitizeModelId(val: unknown, fallback: string): string {
	if (typeof val === 'string') {
		const trimmed = val.trim();
		if (trimmed && trimmed !== 'true' && trimmed !== 'false' && trimmed !== 'null' && trimmed !== 'undefined') {
			return trimmed;
		}
	}
	return fallback;
}

interface AiSettingRow {
	key: string;
	value: string;
	type: string;
	is_sensitive: boolean;
}

function parseValue(row: AiSettingRow): unknown {
	if (row.is_sensitive) return undefined;
	if (row.key.includes('model')) {
		const s = String(row.value || '').trim();
		if (s && s !== 'true' && s !== 'false' && s !== 'null' && s !== 'undefined') return s;
		return undefined; // abai nilai invalid (mis. boolean "true") -> fallback DEFAULTS
	}
	if (row.type === 'number') {
		const n = Number(row.value);
		return Number.isFinite(n) ? n : undefined;
	}
	if (row.type === 'bool') return row.value === 'true' || row.value === '1';
	if (row.type === 'json') {
		try {
			return JSON.parse(row.value);
		} catch {
			return undefined;
		}
	}
	return row.value;
}

/** Ambil config ai_settings yang relevan untuk lapangan, digabung di atas DEFAULTS. Non-fatal: gagal -> default. */
export async function getAiSettings(): Promise<AiSettings> {
	if (cache && cache.exp > Date.now()) return cache.settings;

	try {
		const res = await directusServerJson<{ data?: AiSettingRow[] }>('/items/ai_settings?limit=-1&fields=key,value,type,is_sensitive');
		const rows = res?.data || [];
		const settings: AiSettings = { ...DEFAULTS };
		for (const row of rows) {
			if (!row?.key || !(row.key in settings)) continue;
			const parsed = parseValue(row);
			if (parsed !== undefined) (settings as any)[row.key] = parsed;
		}
		cache = { settings, exp: Date.now() + CACHE_TTL_MS };
		return settings;
	} catch (e: any) {
		console.error('[aiSettings] gagal memuat ai_settings (pakai default):', e?.message);
		return { ...DEFAULTS };
	}
}
