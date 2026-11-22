// src/lib/services/laporanSayaApi.ts
// Report Center Fase 6 — klien "Laporan Saya" (lapangan). Katalog + hitungan lewat /api/reports/katalog,
// pencatatan lewat /api/reports/event (proxy ke admin). Pencatatan fire-and-forget: tidak pernah melempar dan
// tidak perlu di-await, jadi aman dipanggil tepat sebelum navigasi/window.open (tanpa mematikan user-activation).
// Offline: katalog terakhir disimpan di perangkat (localStorage) dan dipakai bila jaringan gagal; event yang gagal
// karena jaringan diantre di IndexedDB lalu dikirim ulang otomatis saat online (offlineReportEventQueue.ts).

import { getIdToken } from '$lib/services/secureDirectus';
import type { LaporanSayaItem } from '$lib/data/laporanSayaFallback';
import { enqueueReportEvent, registerReportEventAutoFlush } from '$lib/utils/offlineReportEventQueue';

export interface LaporanSayaData {
	source: 'directus' | 'seed';
	items: LaporanSayaItem[];
	counts: Record<string, number>;
	/** true = dipakai dari salinan perangkat karena jaringan/server gagal. */
	offline?: boolean;
	/** ISO waktu salinan perangkat terakhir diperbarui (hanya bila offline). */
	cachedAt?: string | null;
}

const CACHE_KEY = 'laporan_saya_cache_v1';

function readCache(): { at: string; data: LaporanSayaData } | null {
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		if (!raw) return null;
		const p = JSON.parse(raw);
		return p && Array.isArray(p?.data?.items) ? p : null;
	} catch {
		return null;
	}
}

function writeCache(data: LaporanSayaData): void {
	try {
		localStorage.setItem(CACHE_KEY, JSON.stringify({ at: new Date().toISOString(), data }));
	} catch {
		/* localStorage penuh/tidak tersedia — non-fatal */
	}
}

/** Online: ambil dari server lalu simpan salinan. Gagal (offline/server): pakai salinan terakhir; tak ada salinan ⇒ lempar. */
export async function fetchLaporanSaya(): Promise<LaporanSayaData> {
	try {
		const token = await getIdToken();
		const res = await fetch('/api/reports/katalog', { headers: { Authorization: `Bearer ${token}` } });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data: LaporanSayaData = await res.json();
		writeCache(data);
		return data;
	} catch (e) {
		const cached = readCache();
		if (cached) return { ...cached.data, offline: true, cachedAt: cached.at };
		throw e;
	}
}

export function logReportEvent(evt: { catalog_key: string; action?: string; format?: string; entity_collection?: string; entity_id?: string | number; reason?: string }): void {
	if (typeof window === 'undefined' || !evt?.catalog_key) return;
	(async () => {
		try {
			const token = await getIdToken();
			if (!token) throw new TypeError('token tidak tersedia'); // dianggap kegagalan jaringan ⇒ diantre
			await fetch('/api/reports/event', {
				method: 'POST',
				keepalive: true,
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify(evt)
			});
		} catch (e: any) {
			// Hanya kegagalan jaringan yang sampai ke sini (respons server apa pun tidak melempar).
			console.warn('[logReportEvent] jaringan gagal, diantre offline:', e?.message);
			await enqueueReportEvent({ ...evt });
		}
	})();
}

/** Kirim ulang antrean saat online. Panggil sekali saat halaman dibuka; kembalikan fungsi pelepas listener. */
export function startReportEventAutoFlush(): () => void {
	return registerReportEventAutoFlush(async (entry) => {
		const token = await getIdToken();
		// Melempar bila jaringan gagal ⇒ entri tetap di antrean; respons server apa pun ⇒ dianggap terkirim.
		await fetch('/api/reports/event', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify(entry.body)
		});
	});
}

/** Rute dibuka langsung hanya bila halaman lapangan (bukan rute admin /print|/reports|/settings|/api) dan tanpa {id}. */
export function isOpenableInLapangan(item: Pick<LaporanSayaItem, 'route_template'>): boolean {
	const r = String(item?.route_template || '');
	if (!r.startsWith('/') || r.includes('{')) return false;
	return !/^\/(print|reports|settings|api)(\/|$)/.test(r);
}

export function filterLaporanSaya(items: LaporanSayaItem[], q: string, onlyFav: boolean, favs: Set<string>): LaporanSayaItem[] {
	const k = (q || '').trim().toLowerCase();
	return (items || []).filter((r) => {
		if (onlyFav && !favs.has(r.key)) return false;
		if (!k) return true;
		return `${r.title} ${r.hint || ''} ${r.department || ''}`.toLowerCase().includes(k);
	});
}
