// src/lib/services/gateChangeBanner.ts
// L1 — klien umpan "aturan gate berubah" + daftar yang sudah ditutup pengguna (localStorage, per perangkat).
// Cache memori 5 menit. Tidak pernah melempar: gagal => daftar kosong (banner tidak tampil).
import { getIdToken } from '$lib/services/secureDirectus';

export interface GateChange {
	id: number | string;
	gate_key: string;
	nama: string;
	jenis: string;
	from: string;
	to: string;
	enforce_from: string | null;
	date: string;
	hint: string | null;
}

const TTL_MS = 5 * 60 * 1000;
const DISMISS_KEY = 'gate_change_dismissed_v1';
let cache: { at: number; data: GateChange[] } | null = null;

const MODE_LABEL: Record<string, string> = { '(bawaan)': 'tidak aktif', off: 'tidak aktif', shadow: 'dicatat saja', warn: 'peringatan', soft: 'peringatan', hard: 'WAJIB (memblokir)' };
export const modeLabel = (m: string) => MODE_LABEL[m] || m;

export function getDismissed(): Set<string> {
	try {
		return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]').map(String));
	} catch {
		return new Set();
	}
}

export function dismissChange(id: number | string) {
	try {
		const s = getDismissed();
		s.add(String(id));
		// batasi ukuran: simpan 200 id terakhir saja
		localStorage.setItem(DISMISS_KEY, JSON.stringify([...s].slice(-200)));
	} catch {
		/* localStorage tak tersedia -- banner muncul lagi saat reload, tak fatal */
	}
}

export async function fetchGateChanges(days = 7): Promise<GateChange[]> {
	if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
	try {
		const token = await getIdToken();
		const res = await fetch(`/api/gates/perubahan-terbaru?days=${days}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
		if (!res.ok) return [];
		const d = await res.json().catch(() => null);
		const list: GateChange[] = Array.isArray(d?.changes) ? d.changes : [];
		cache = { at: Date.now(), data: list };
		return list;
	} catch {
		return [];
	}
}
