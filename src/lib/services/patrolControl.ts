// src/lib/services/patrolControl.ts
// Klien untuk setelan "Pertajam Kontrol Patroli" Fase 1 (app_settings module='patrol_control').
// Cache 5 menit di sisi klien supaya tidak polling server tiap render.

import { auth } from '$lib/firebase';

export interface PatrolControlSettings {
	manualInputMode: 'disabled' | 'supervisor_override' | 'enabled';
	galleryUploadEnabled: boolean;
	gpsEnforcement: 'hard' | 'soft' | 'off';
	minIntervalSeconds: number;
	minPatrolDurationMinutes: number;
	wajibCekRuanganMode: 'shadow' | 'soft' | 'hard';
	minDwellMinutes: number;
	/** Mode gate G_PATROL_SPEEDRUN_SELESAI_RONDA (Fase 3) — dibaca dari gate_definitions. */
	speedrunGateMode: 'shadow' | 'soft' | 'warn' | 'hard';
}

export const PATROL_CONTROL_DEFAULTS: PatrolControlSettings = {
	manualInputMode: 'supervisor_override',
	galleryUploadEnabled: false,
	gpsEnforcement: 'soft',
	minIntervalSeconds: 60,
	minPatrolDurationMinutes: 10,
	wajibCekRuanganMode: 'soft',
	minDwellMinutes: 10,
	speedrunGateMode: 'soft'
};

const CACHE_TTL_MS = 300_000;
let _cache: { at: number; value: PatrolControlSettings } | null = null;

export async function fetchPatrolControlSettings(): Promise<PatrolControlSettings> {
	if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.value;
	try {
		const user = auth.currentUser;
		if (!user) return PATROL_CONTROL_DEFAULTS;
		const idToken = await user.getIdToken();
		const res = await fetch('/api/patrol-control/settings', { headers: { Authorization: `Bearer ${idToken}` } });
		if (!res.ok) throw new Error(`Gagal (${res.status})`);
		const value = (await res.json()) as PatrolControlSettings;
		_cache = { at: Date.now(), value };
		return value;
	} catch (err) {
		console.error('[patrolControl] gagal baca setelan kontrol patroli, pakai default:', err);
		return PATROL_CONTROL_DEFAULTS;
	}
}
