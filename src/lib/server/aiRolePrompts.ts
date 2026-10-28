// src/lib/server/aiRolePrompts.ts
// SERVER-ONLY. Port TypeScript dari lib/server/aiRolePrompts.js (erp-epi-1) —
// system prompt tambahan PER ROLE (5C#5, implementation_plan_asisten_ai_v2.md),
// koleksi Directus `ai_role_prompts` yang SAMA (dibagi kedua repo).

import { directusServerJson } from './directus';

interface RolePromptRow {
	role_id: string;
	target_app: 'admin' | 'field' | 'both';
	prompt_text: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { rows: RolePromptRow[]; exp: number } | null = null;

async function loadRows(): Promise<RolePromptRow[]> {
	if (cache && cache.exp > Date.now()) return cache.rows;
	try {
		const res = await directusServerJson<{ data?: RolePromptRow[] }>(
			'/items/ai_role_prompts?filter[aktif][_eq]=true&sort=sort,role_id&fields=role_id,target_app,prompt_text&limit=-1'
		);
		const rows = res?.data || [];
		cache = { rows, exp: Date.now() + CACHE_TTL_MS };
		return rows;
	} catch (e: any) {
		console.error('[aiRolePrompts] gagal memuat ai_role_prompts (diabaikan):', e?.message);
		return [];
	}
}

/** Teks instruksi tambahan untuk role tsb, siap-sisip ke system prompt. Non-fatal: gagal/kosong -> ''. */
export async function getRolePromptText(roleId: string | null, app: 'admin' | 'field'): Promise<string> {
	if (!roleId) return '';
	const rows = await loadRows();
	const matches = rows.filter((r) => r.role_id === roleId && (r.target_app === app || r.target_app === 'both'));
	if (!matches.length) return '';
	return `Instruksi tambahan khusus untuk peran Anda saat ini:\n${matches.map((r) => `- ${r.prompt_text}`).join('\n')}`;
}
