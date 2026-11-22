// src/lib/services/projectCompletenessMine.ts
// Klien tipis ke proxy /api/project/completeness-mine (→ erp-epi): kelengkapan proyek milik user. Bearer token Firebase,
// cache modul 60 dtk (server cache 5 menit). READ-ONLY. Kegagalan DILEMPAR. Fungsi pemilih item (buildTodoItems) MURNI.
import { getIdToken } from './secureDirectus';

export interface CompletenessGap { key: string; label: string; detail: string | null; severity: 'rendah' | 'sedang' | 'tinggi' | 'kritis'; owner: string; slaHours: number; action: string; hint: string }
export interface CompletenessReview { key: string; label: string; owner: string; action: string; hint: string }
export interface CompletenessAnomaly { key: string; label: string; detail: string | null; severity: 'rendah' | 'sedang' | 'tinggi' | 'kritis'; owner: string; action: string; hint: string }
export interface CompletenessRow { id: number; name: string; nomorPo: string | null; status: string; completenessPct: number | null; band: string; gaps: CompletenessGap[]; review: CompletenessReview[]; anomalies?: CompletenessAnomaly[]; unknown: string[] }
export interface MyCompletenessData { summary: Record<string, number>; rows: CompletenessRow[]; warnings: string[]; generatedAt: string }
export interface TodoItem { projectId: number; projectName: string; label: string; action: string; owner: string; slaHours: number | null; severity: string; kind: 'gap' | 'review' | 'anomali' }

export interface RankingEntry { rank: number; name: string; projects: number; avgPct: number; dataKurang: number; isMe: boolean }
export interface LeaderRankingData { ranking: RankingEntry[]; total: number; me: { rank: number; avgPct: number; projects: number } | null; partial: boolean; generatedAt: string }

let cachedRank: { at: number; promise: Promise<LeaderRankingData> } | null = null;
/** Peringkat kelengkapan antar-leader (server cache 5 menit; klien 60 dtk). Kegagalan DILEMPAR. */
export function fetchLeaderRanking(force = false): Promise<LeaderRankingData> {
	if (!force && cachedRank && Date.now() - cachedRank.at < 60_000) return cachedRank.promise;
	const promise = (async () => {
		const token = await getIdToken();
		const res = await fetch(`/api/project/completeness-mine?view=ranking${force ? '&fresh=1' : ''}`, { headers: { Authorization: `Bearer ${token}` } });
		if (!res.ok) throw new Error(`Gagal memuat peringkat (${res.status})`);
		const j = await res.json();
		return (j?.data ?? { ranking: [], total: 0, me: null, partial: false, generatedAt: '' }) as LeaderRankingData;
	})().catch((err) => {
		cachedRank = null;
		throw err;
	});
	cachedRank = { at: Date.now(), promise };
	return promise;
}

let cached: { at: number; promise: Promise<MyCompletenessData> } | null = null;

export function fetchMyCompleteness(force = false): Promise<MyCompletenessData> {
	if (!force && cached && Date.now() - cached.at < 60_000) return cached.promise;
	const promise = (async () => {
		const token = await getIdToken();
		const qs = new URLSearchParams({ status: 'on progress,prepare,hold,repair,waiting' });
		if (force) qs.set('fresh', '1');
		const res = await fetch(`/api/project/completeness-mine?${qs.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
		if (!res.ok) throw new Error(`Gagal memuat kelengkapan proyek (${res.status})`);
		const j = await res.json();
		return (j?.data ?? { summary: {}, rows: [], warnings: [], generatedAt: '' }) as MyCompletenessData;
	})().catch((err) => {
		cached = null; // jangan cache kegagalan
		throw err;
	});
	cached = { at: Date.now(), promise };
	return promise;
}

const KIND: Record<string, number> = { anomali: 0, gap: 1, review: 2 };
const SEV: Record<string, number> = { kritis: 4, tinggi: 3, sedang: 2, rendah: 1 };

/**
 * MURNI: daftar "yang harus saya lengkapi" — anomali & kekurangan data (urut keparahan; anomali lebih dulu pada keparahan sama), lalu tinjauan status proyek AKTIF.
 * Proyek `waiting` TIDAK dijabarkan per proyek (bisa puluhan): dihitung terpisah di `waitingReview`.
 */
export function buildTodoItems(rows: CompletenessRow[] | null | undefined, limit = 5) {
	const items: TodoItem[] = [];
	let waitingReview = 0;
	for (const r of rows ?? []) {
		const isWaiting = String(r.status).toLowerCase() === 'waiting';
		for (const a of r.anomalies ?? []) items.push({ projectId: r.id, projectName: r.name, label: a.label + (a.detail ? ` — ${a.detail}` : ''), action: a.action, owner: a.owner, slaHours: null, severity: a.severity, kind: 'anomali' });
		for (const g of r.gaps ?? []) items.push({ projectId: r.id, projectName: r.name, label: g.label + (g.detail ? ` — ${g.detail}` : ''), action: g.action, owner: g.owner, slaHours: g.slaHours ?? null, severity: g.severity, kind: 'gap' });
		for (const v of r.review ?? []) {
			if (isWaiting) { waitingReview++; continue; }
			items.push({ projectId: r.id, projectName: r.name, label: v.label, action: v.action, owner: v.owner, slaHours: null, severity: 'sedang', kind: 'review' });
		}
	}
	items.sort((a, b) => (SEV[b.severity] ?? 0) - (SEV[a.severity] ?? 0) || (KIND[a.kind] - KIND[b.kind]));
	return { total: items.length, shown: items.slice(0, Math.max(1, limit)), waitingReview };
}
