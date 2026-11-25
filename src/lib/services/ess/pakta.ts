// src/lib/services/ess/pakta.ts
// Client-side wrapper Pakta Pra-Kegiatan: /api/ess/pakta-aktif (status per halaman), /api/process-guidance/read-confirm (setuju +
// tanda tangan otomatis), /api/ess/pakta-keberatan (ada kendala). Status per halaman di-cache di memori klien supaya berpindah-pindah
// halaman tidak menambah panggilan; cache dibuang saat ada persetujuan/kendala baru atau event refresh.
import { auth } from '$lib/firebase';

export const PAKTA_REFRESH_EVENT = 'pakta:refresh';
const CLIENT_TTL_MS = 120_000;

export interface PaktaItem {
	type: 'sop' | 'flow' | 'gate';
	id: number;
	gate_key?: string | null;
	gate_to?: string | null;
	flow_key: string | null;
	sop_id: number | null;
	title: string | null;
	sop_code: string | null;
	version: number;
	sosialisasi_end_date: string | null;
	ringkasan: string | null;
	/** null untuk jenis gate (tidak ada halaman baca) */
	baca_url: string | null;
}

export interface PaktaStatus {
	enabled: boolean;
	label?: string | null;
	gate_nama?: string | null;
	gate_hint?: string | null;
	settings?: { min_read_seconds: number; require_scroll: boolean };
	decision: { show: boolean; presentation: 'none' | 'banner' | 'modal'; blocked: boolean; canProceedWithNote: boolean };
	items: PaktaItem[];
}

export interface PaktaStamp {
	confirmed_at: string | null;
	signature: string | null;
}

async function authHeader(): Promise<Record<string, string>> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return { Authorization: `Bearer ${await user.getIdToken()}` };
}

const cache = new Map<string, { at: number; value: PaktaStatus }>();
const statusInflight = new Map<string, Promise<PaktaStatus>>();
const DISABLED_TTL_MS = 300_000;
let disabledUntil = 0; // fitur mati di server → jangan tanya lagi tiap navigasi (setara TTL cache setelan server)
const NONAKTIF: PaktaStatus = { enabled: false, decision: { show: false, presentation: 'none', blocked: false, canProceedWithNote: false }, items: [] };

let sayaCache: { at: number; value: PaktaSaya } | null = null; // tipe PaktaSaya dideklarasikan di bawah (hoisted)
let sayaInflight: Promise<PaktaSaya> | null = null;
export function invalidatePaktaCache(): void {
	sayaCache = null;
	sayaInflight = null;
	cache.clear();
	statusInflight.clear();
	disabledUntil = 0;
}

export async function getPaktaStatus(path: string, opts: { force?: boolean } = {}): Promise<PaktaStatus> {
	if (!opts.force && Date.now() < disabledUntil) return NONAKTIF;
	const hit = cache.get(path);
	if (!opts.force && hit && Date.now() - hit.at < CLIENT_TTL_MS) return hit.value;
	if (!opts.force) {
		const running = statusInflight.get(path);
		if (running) return running;
	}
	const pending = (async (): Promise<PaktaStatus> => {
		const res = await fetch(`/api/ess/pakta-aktif?path=${encodeURIComponent(path)}`, { headers: await authHeader() });
		if (!res.ok) throw new Error(`Gagal (${res.status})`);
		const value = (await res.json()) as PaktaStatus;
		if (value?.enabled === false) disabledUntil = Date.now() + DISABLED_TTL_MS;
		cache.set(path, { at: Date.now(), value });
		return value;
	})().finally(() => {
		if (statusInflight.get(path) === pending) statusInflight.delete(path);
	});
	statusInflight.set(path, pending);
	return pending;
}

/** Setuju = tanda tangan otomatis: server mencatat konfirmasi baca (versi dari server) dan membalas kode bukti. */
export async function setujuiPakta(item: Pick<PaktaItem, 'type' | 'flow_key' | 'sop_id' | 'version'> & { gate_key?: string | null }, route = ''): Promise<PaktaStamp> {
	if (item.type === 'gate') {
		const r = await fetch('/api/ess/pakta-setuju-gate', {
			method: 'POST',
			headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
			body: JSON.stringify({ gate_key: item.gate_key, route })
		});
		const d = await r.json().catch(() => ({}));
		if (!r.ok) throw new Error(d?.message || `Gagal menyimpan persetujuan (${r.status})`);
		invalidatePaktaCache();
		return { confirmed_at: d?.confirmed_at ?? null, signature: d?.signature ?? null };
	}
	const body = item.type === 'flow' ? { flow_key: item.flow_key, version_seq: item.version } : { sop_id: item.sop_id, version_seq: item.version };
	const res = await fetch('/api/process-guidance/read-confirm', {
		method: 'POST',
		headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data?.message || `Gagal menyimpan persetujuan (${res.status})`);
	invalidatePaktaCache();
	return { confirmed_at: data?.confirmed_at ?? null, signature: data?.signature ?? null };
}

export async function ajukanKendalaPakta(
	item: Pick<PaktaItem, 'type' | 'flow_key' | 'sop_id'> & { gate_key?: string | null },
	input: { kategori: string; alasan: string; route: string }
): Promise<{ duplicate: boolean; message: string }> {
	const base = item.type === 'gate' ? { gate_key: item.gate_key } : item.type === 'flow' ? { flow_key: item.flow_key } : { sop_id: item.sop_id };
	const res = await fetch('/api/ess/pakta-keberatan', {
		method: 'POST',
		headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
		body: JSON.stringify({ ...base, ...input })
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data?.message || `Gagal mengirim kendala (${res.status})`);
	invalidatePaktaCache();
	return { duplicate: data?.duplicate === true, message: data?.message || 'Kendala dicatat.' };
}

export function requestPaktaRefresh(): void {
	invalidatePaktaCache();
	if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PAKTA_REFRESH_EVENT));
}

export interface PaktaSayaItem {
	key: string;
	type: 'sop' | 'flow' | 'gate';
	title: string | null;
	sop_code: string | null;
	version: number;
	route: string | null;
	label: string | null;
	baca_url: string | null;
	status_kendala: 'menunggu' | 'dispensasi' | 'ditolak' | null;
}
export interface PaktaSaya {
	enabled: boolean;
	count: number;
	prosedur: PaktaSayaItem[];
	gate: PaktaSayaItem[];
}

const SAYA_TTL_MS = 120_000;


/** Daftar "Pakta & Aturan Saya" untuk dropdown header. Di-cache 2 menit + in-flight coalescing (sidebar & topbar berbagi 1 fetch). */
export async function getPaktaSaya(opts: { force?: boolean } = {}): Promise<PaktaSaya> {
	if (!opts.force && sayaCache && Date.now() - sayaCache.at < SAYA_TTL_MS) return sayaCache.value;
	if (!opts.force && Date.now() < disabledUntil) return { enabled: false, count: 0, prosedur: [], gate: [] };
	if (!opts.force && sayaInflight) return sayaInflight;
	const pending = (async (): Promise<PaktaSaya> => {
		const res = await fetch('/api/ess/pakta-saya', { headers: await authHeader() });
		if (!res.ok) throw new Error(`Gagal (${res.status})`);
		const value = (await res.json()) as PaktaSaya;
		if (value?.enabled === false) disabledUntil = Date.now() + DISABLED_TTL_MS;
		sayaCache = { at: Date.now(), value };
		return value;
	})().finally(() => {
		if (sayaInflight === pending) sayaInflight = null;
	});
	sayaInflight = pending;
	return pending;
}
