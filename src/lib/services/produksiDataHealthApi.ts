// src/lib/services/produksiDataHealthApi.ts
// Fase 5 (Laporan Bulanan Manufaktur): klien tipis untuk /api/produksi/data-health.
import { getIdToken } from './secureDirectus';
import type { SpkDataHealth } from '$lib/server/produksi/dataHealth';

export type { SpkDataHealth };

export async function fetchSpkDataHealth(): Promise<SpkDataHealth> {
	const token = await getIdToken();
	const res = await fetch('/api/produksi/data-health', { headers: { Authorization: `Bearer ${token}` } });
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(body?.message || `Gagal (${res.status})`);
	return body.data as SpkDataHealth;
}
