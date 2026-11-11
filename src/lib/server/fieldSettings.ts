// src/lib/server/fieldSettings.ts
// SERVER-ONLY. Pembaca satu-namespace system_settings (mis. `project.field_dossier.`) untuk endpoint lapangan — SATU query,
// bukan satu per kunci. Gagal baca -> { ok:false } dan pemanggil memakai default di kodenya (dicatat, bukan disamarkan).
// Nilai di-parse menurut setting_type (boolean/number/json); kunci tanpa nilai dilewati supaya default pemanggil berlaku.

import { directusServerJson } from '$lib/server/directus';

export function parseSettingValue(type: string | null | undefined, raw: unknown): unknown {
	if (raw == null || raw === '') return undefined;
	if (typeof raw !== 'string') return raw;
	if (type === 'boolean') return raw === 'true' || raw === '1';
	if (type === 'number') {
		const n = Number(raw);
		return Number.isFinite(n) ? n : undefined;
	}
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

export async function readSettingsNamespace(namespace: string): Promise<{ ok: boolean; cfg: Record<string, unknown>; message?: string }> {
	try {
		const r = await directusServerJson<{ data: Array<{ setting_key: string; setting_type: string; setting_value: unknown }> }>(
			`/items/system_settings?filter[setting_key][_starts_with]=${encodeURIComponent(namespace)}&fields=setting_key,setting_type,setting_value&limit=-1`
		);
		const cfg: Record<string, unknown> = {};
		for (const row of r?.data || []) {
			const v = parseSettingValue(row.setting_type, row.setting_value);
			if (v !== undefined) cfg[row.setting_key] = v;
		}
		return { ok: true, cfg };
	} catch (e: any) {
		console.warn(`[fieldSettings] gagal baca setelan ${namespace} (pakai default):`, e?.message || e);
		return { ok: false, cfg: {}, message: e?.message };
	}
}

/** Angka > 0 dari setelan, selain itu fallback. */
export function positiveNumber(v: unknown, fallback: number): number {
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}
