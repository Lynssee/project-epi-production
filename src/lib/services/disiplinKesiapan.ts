// src/lib/services/disiplinKesiapan.ts
// Klien tipis lintas-origin ke erp-epi GET /api/disiplin/kesiapan-hari-ini (Fase 5 "Gate
// Disiplin Lapangan", 5 Okt 2026). Pola sama projectFulfillment.ts: Bearer token Firebase
// yang sama, cache modul singkat. READ-ONLY.
import { getIdToken } from './secureDirectus';

const ADMIN_APP_ORIGIN = '';
const TTL_MS = 60_000;

export interface KesiapanItem {
	applicable: boolean;
	ok: boolean;
	detail: string;
	actionUrl?: string | null;
}

export interface KesiapanHariIni {
	success: boolean;
	tanggal: string;
	profile: { wajib_visit: boolean; wajib_p2h: boolean; wajib_dokumen_jalan: boolean; pola_kerja: string | null };
	p2h: KesiapanItem;
	visit: KesiapanItem;
	dokumen_jalan: KesiapanItem;
	retur: KesiapanItem;
}

let cached: { at: number; promise: Promise<KesiapanHariIni> } | null = null;

export function fetchKesiapanHariIni(force = false): Promise<KesiapanHariIni> {
	if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.promise;
	const promise = (async () => {
		const token = await getIdToken();
		const res = await fetch('/api/disiplin/kesiapan-hari-ini', {
			headers: { Authorization: `Bearer ${token}` }
		});
		if (!res.ok) throw new Error(`Gagal memuat kesiapan hari ini (${res.status})`);
		return (await res.json()) as KesiapanHariIni;
	})().catch((err) => {
		cached = null; // jangan cache kegagalan
		throw err;
	});
	cached = { at: Date.now(), promise };
	return promise;
}
