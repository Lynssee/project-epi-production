// src/lib/server/ess/pettyCashLpjSettings.ts
// SERVER-ONLY. PC3-14 — pembaca setelan aturan LPJ (system_settings petty_cash.*) + pencatat gate untuk kanal lapangan,
// setara admin (readSystemSettingJson + logPettyCashGateDecision) supaya LPJ dari HP dan admin berlaku aturan yang sama.

import { directusServerJson } from '$lib/server/directus';

/** Baca satu setelan system_settings; nilai bisa number / string / JSON-string. Gagal baca → default (dicatat). */
export async function readPettyCashSetting<T>(key: string, fallback: T): Promise<T> {
	try {
		const r = await directusServerJson<{ data: { setting_value: any }[] }>(
			`/items/system_settings?limit=1&fields=setting_value&filter[setting_key][_eq]=${encodeURIComponent(key)}`
		);
		const v = r?.data?.[0]?.setting_value;
		if (v === undefined || v === null || v === '') return fallback;
		if (typeof v === 'string') {
			try {
				return JSON.parse(v) as T;
			} catch {
				return v as unknown as T;
			}
		}
		return v as T;
	} catch (e: any) {
		console.error(`[pettyCashLpjSettings] gagal baca setelan ${key} (pakai default):`, e?.message || e);
		return fallback;
	}
}

/** Catat keputusan gate LPJ ke gate_audit_log (pola sama admin logPettyCashGateDecision). Tak pernah melempar. */
export async function logLpjGateDecision(p: {
	gate: string;
	decision: 'warn' | 'block';
	reason: string;
	recordId: number | string;
	email?: string | null;
	snapshot?: Record<string, unknown>;
}): Promise<void> {
	try {
		await directusServerJson('/items/gate_audit_log', {
			method: 'POST',
			body: JSON.stringify({
				gate: p.gate,
				collection: 'items/petty_cash_requests',
				method: 'POST',
				record_id: String(p.recordId),
				decision: p.decision,
				reason: p.reason,
				payload_snapshot: p.snapshot || null,
				user_email: p.email || null
			})
		});
	} catch (e: any) {
		console.error('[pettyCashLpjSettings] gagal menulis gate_audit_log:', e?.message || e);
	}
}

/** Mode & enforce_from gate_enforcement (jenis 'PC') untuk satu gate; default shadow bila baris tak ada / gagal baca. */
export async function readGateConfig(gateKey: string): Promise<{ mode: 'shadow' | 'soft' | 'hard'; enforceFrom: string | null }> {
	try {
		const r = await directusServerJson<{ data: { mode: string; enforce_from: string | null }[] }>(
			`/items/gate_enforcement?limit=1&fields=mode,enforce_from&filter[jenis_pengajuan][_eq]=PC&filter[gate_key][_eq]=${encodeURIComponent(gateKey)}`
		);
		const row = r?.data?.[0];
		if (!row) return { mode: 'shadow', enforceFrom: null };
		const ef = row.enforce_from ? String(row.enforce_from).slice(0, 10) : null;
		// enforce_from di masa depan → mode efektif shadow (anti-lockdown retroaktif, sama dengan admin effectiveMode)
		const today = new Date().toISOString().slice(0, 10);
		const mode = (['shadow', 'soft', 'hard'].includes(row.mode) ? row.mode : 'shadow') as 'shadow' | 'soft' | 'hard';
		return { mode: ef && ef > today ? 'shadow' : mode, enforceFrom: ef };
	} catch (e: any) {
		console.error(`[pettyCashLpjSettings] gagal baca gate_enforcement ${gateKey} (dianggap shadow):`, e?.message || e);
		return { mode: 'shadow', enforceFrom: null };
	}
}
