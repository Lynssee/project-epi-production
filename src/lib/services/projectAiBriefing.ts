// src/lib/services/projectAiBriefing.ts
// Klien tipis lintas-origin ke erp-epi GET /api/project/[id]/ai-briefing (Briefing Lapangan AI, PASIF).
// Pola sama projectFulfillment.ts: Bearer token Firebase yang sama. READ-ONLY dan tanpa tombol pemicu: Project Leader
// hanya MENERIMA hasil yang dihitung server (keputusan 9 Nov 2026) — tidak ada parameter refresh/force di sini.
//
// Offline-resilient: respons sukses terakhir disimpan di localStorage; bila jaringan gagal, kartu menampilkan salinan
// itu dengan label tanggal. Centang langkah taktis disimpan LOKAL di perangkat per hari (tidak dikirim ke server —
// hanya alat bantu ingatan Leader; tidak dianggap bukti pelaksanaan).
import { getIdToken } from './secureDirectus';

const ADMIN_APP_ORIGIN = '';
const MEM_TTL_MS = 5 * 60_000;
const OFFLINE_PREFIX = 'ai-briefing:v1:';
const CHECK_PREFIX = 'ai-briefing-check:v1:';

export type BriefingStatus = 'ok' | 'info' | 'warning' | 'danger' | 'unknown';

export interface BriefingItem {
	key: string;
	status: BriefingStatus;
	title: string;
	evidence: string;
	action: string | null;
	pic: string | null;
}

export interface BriefingGap {
	key: string;
	title: string;
	reason: string;
}

export interface FieldBriefing {
	available: boolean;
	reason?: string;
	project_id: number | null;
	horizon: 'pendek';
	status?: BriefingStatus;
	/** terukur | belum_terukur | sumber_gagal | tanpa_sumber | dibatasi */
	coverage?: string;
	score?: number | null;
	summary?: string;
	focus?: string;
	items?: BriefingItem[];
	gaps?: BriefingGap[];
	generated_at?: string | null;
	input_hash?: string | null;
	cached?: boolean;
	cache_age_seconds?: number;
}

export interface OfflineBriefing {
	briefing: FieldBriefing;
	/** Kapan salinan ini disimpan di perangkat (ISO). */
	savedAt: string;
}

const mem = new Map<string, { at: number; promise: Promise<FieldBriefing> }>();

function safeStorage(): Storage | null {
	try {
		return typeof localStorage !== 'undefined' ? localStorage : null;
	} catch {
		return null; // mode privat / akses diblokir
	}
}

export function saveOfflineBriefing(projectId: number | string, briefing: FieldBriefing): void {
	try {
		safeStorage()?.setItem(OFFLINE_PREFIX + projectId, JSON.stringify({ briefing, savedAt: new Date().toISOString() }));
	} catch (e) {
		console.warn('[projectAiBriefing] gagal menyimpan salinan offline:', e);
	}
}

export function loadOfflineBriefing(projectId: number | string): OfflineBriefing | null {
	try {
		const raw = safeStorage()?.getItem(OFFLINE_PREFIX + projectId);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (!parsed?.briefing || typeof parsed.savedAt !== 'string') return null;
		return parsed as OfflineBriefing;
	} catch {
		return null; // data rusak => abaikan, jangan crash
	}
}

/** Ambil briefing terbaru. Sukses => disimpan sebagai salinan offline. Gagal => lempar (pemanggil boleh pakai offline). */
export function fetchFieldBriefing(projectId: number | string): Promise<FieldBriefing> {
	const key = String(projectId);
	const hit = mem.get(key);
	if (hit && Date.now() - hit.at < MEM_TTL_MS) return hit.promise;
	const promise = (async () => {
		const token = await getIdToken();
		const res = await fetch(`${ADMIN_APP_ORIGIN}/api/project/${key}/ai-briefing`, {
			headers: { Authorization: `Bearer ${token}` }
		});
		if (!res.ok) throw new Error(`Gagal memuat briefing lapangan (${res.status})`);
		const data = (await res.json()) as FieldBriefing;
		if (data?.available) saveOfflineBriefing(key, data);
		return data;
	})().catch((err) => {
		mem.delete(key); // jangan cache kegagalan
		throw err;
	});
	mem.set(key, { at: Date.now(), promise });
	return promise;
}

/** Kunci hari lokal perangkat (YYYY-MM-DD) — centang otomatis kembali kosong esok hari. */
export function localDayKey(d: Date = new Date()): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function loadChecked(projectId: number | string, day: string = localDayKey()): Set<string> {
	try {
		const raw = safeStorage()?.getItem(`${CHECK_PREFIX}${projectId}:${day}`);
		const arr = raw ? JSON.parse(raw) : [];
		return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []);
	} catch {
		return new Set();
	}
}

export function saveChecked(projectId: number | string, checked: Set<string>, day: string = localDayKey()): void {
	try {
		safeStorage()?.setItem(`${CHECK_PREFIX}${projectId}:${day}`, JSON.stringify([...checked]));
	} catch (e) {
		console.warn('[projectAiBriefing] gagal menyimpan centang lokal:', e);
	}
}

/** Teks "diperbarui … lalu" untuk label umur data. */
export function ageLabel(iso: string | null | undefined, now: number = Date.now()): string {
	if (!iso) return '';
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return '';
	const min = Math.max(0, Math.round((now - t) / 60_000));
	if (min < 1) return 'baru saja';
	if (min < 60) return `${min} menit lalu`;
	const h = Math.round(min / 60);
	return h < 24 ? `${h} jam lalu` : `${Math.round(h / 24)} hari lalu`;
}
