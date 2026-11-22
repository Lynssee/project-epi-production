// src/lib/utils/offlineTrainingCache.ts
// Materi training (modul Teks) bisa DIBACA offline di lapangan. Kursus yang pernah dibuka saat online disimpan di IndexedDB;
// saat sinyal hilang halaman kursus memakai salinan itu (read-only: progres, kuis, dan catatan tetap butuh sinyal).
// Pola sama dengan offlineSopCache.ts. Cache = kenyamanan, BUKAN sumber kebenaran: gagal baca/tulis tidak pernah memblokir halaman.

import { openDB, type IDBPDatabase } from 'idb';
import type { KursusDetail } from '$lib/services/ess/training';

const DB_NAME = 'epi_training_cache';
const STORE = 'cached_kursus';
/** Batas jumlah kursus tersimpan (yang terlama dibuang) — jaga penyimpanan HP tetap kecil. */
export const MAX_CACHED_KURSUS = 15;
/** Salinan lebih tua dari ini dianggap basi dan tidak ditampilkan (materi bisa berubah: SOP naik versi). */
export const MAX_CACHE_AGE_DAYS = 30;

export interface CachedKursus {
	programId: number;
	cachedAt: string; // ISO
	detail: KursusDetail;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
	if (typeof indexedDB === 'undefined') throw new Error('IndexedDB tidak tersedia di perangkat ini');
	if (!dbPromise) {
		dbPromise = openDB(DB_NAME, 1, {
			upgrade(db) {
				if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'programId' });
			}
		});
	}
	return dbPromise;
}

/** Hanya modul Teks yang berguna offline; modul video/PDF/link butuh sinyal sehingga tidak perlu disimpan isinya. */
export function hasOfflineReadableContent(detail: KursusDetail | null | undefined): boolean {
	return !!detail?.modules?.some((m) => (m.modul?.tipe_konten ?? 'Teks') === 'Teks' && String(m.modul?.konten_teks ?? '').trim().length > 0);
}

/** Salinan masih layak tampil? (umur ≤ MAX_CACHE_AGE_DAYS). Murni — dites. */
export function isCacheFresh(cachedAt: string, now: number = Date.now()): boolean {
	const t = Date.parse(cachedAt);
	return Number.isFinite(t) && now - t <= MAX_CACHE_AGE_DAYS * 24 * 60 * 60 * 1000;
}

export async function cacheKursusDetail(detail: KursusDetail): Promise<void> {
	try {
		if (!detail?.program?.id || !hasOfflineReadableContent(detail)) return;
		const db = await getDb();
		await db.put(STORE, { programId: Number(detail.program.id), cachedAt: new Date().toISOString(), detail } satisfies CachedKursus);
		const all = (await db.getAll(STORE)) as CachedKursus[];
		if (all.length > MAX_CACHED_KURSUS) {
			const surplus = all.sort((a, b) => a.cachedAt.localeCompare(b.cachedAt)).slice(0, all.length - MAX_CACHED_KURSUS);
			await Promise.all(surplus.map((r) => db.delete(STORE, r.programId)));
		}
	} catch {
		/* non-fatal */
	}
}

export async function getCachedKursusDetail(programId: number): Promise<CachedKursus | null> {
	try {
		const db = await getDb();
		const row = (await db.get(STORE, Number(programId))) as CachedKursus | undefined;
		return row && isCacheFresh(row.cachedAt) ? row : null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Unduh proaktif ("Siapkan untuk offline") + daftar kursus offline.
// Bagian murni (selectPrefetchTargets, summarizeCache) dites di offlineTrainingCache.test.ts.
// ---------------------------------------------------------------------------

/** Batas kursus yang diunduh sekali tekan — jaga kuota & penyimpanan HP. */
export const MAX_PREFETCH_PER_RUN = 8;

export interface PrefetchCandidate {
	programId: number;
	wajib: boolean;
	terdaftar: boolean;
	status?: string | null;
	progress?: number | null;
}

/**
 * Kursus mana yang layak diunduh: hanya yang sudah diikuti & belum Lulus (yang masih akan dibaca),
 * kursus WAJIB lebih dulu, lalu yang progresnya paling tinggi (sedang berjalan). Yang salinannya masih segar dilewati.
 */
export function selectPrefetchTargets(items: PrefetchCandidate[] | null | undefined, freshIds: Set<number>, max: number = MAX_PREFETCH_PER_RUN): number[] {
	return (Array.isArray(items) ? items : [])
		.filter((k) => k && k.terdaftar && k.status !== 'Lulus' && !freshIds.has(Number(k.programId)))
		.sort((a, b) => Number(b.wajib) - Number(a.wajib) || (Number(b.progress) || 0) - (Number(a.progress) || 0) || a.programId - b.programId)
		.slice(0, Math.max(0, max))
		.map((k) => Number(k.programId));
}

export interface CachedKursusInfo {
	programId: number;
	cachedAt: string;
}

/** Daftar salinan yang masih segar (tanpa isi materi). */
export async function listCachedKursus(): Promise<CachedKursusInfo[]> {
	try {
		const db = await getDb();
		const all = (await db.getAll(STORE)) as CachedKursus[];
		return all.filter((r) => isCacheFresh(r.cachedAt)).map((r) => ({ programId: r.programId, cachedAt: r.cachedAt })).sort((a, b) => b.cachedAt.localeCompare(a.cachedAt));
	} catch {
		return [];
	}
}

export async function clearCachedKursus(): Promise<void> {
	try {
		const db = await getDb();
		await db.clear(STORE);
	} catch {
		/* non-fatal */
	}
}

export interface PrefetchResult {
	tersimpan: number;
	dilewati: number; // tak punya materi teks (video/PDF saja) atau gagal diunduh
	gagal: number;
}

/**
 * Unduh berurutan (bukan paralel: hemat sinyal lemah). `fetchDetail` disuntik supaya mudah dites.
 * Berhenti lebih awal bila perangkat offline di tengah jalan; yang sudah tersimpan tetap dipakai.
 */
export async function prefetchKursus(
	programIds: number[],
	fetchDetail: (id: number) => Promise<KursusDetail>,
	onProgress?: (selesai: number, total: number) => void
): Promise<PrefetchResult> {
	const res: PrefetchResult = { tersimpan: 0, dilewati: 0, gagal: 0 };
	for (let i = 0; i < programIds.length; i++) {
		if (typeof navigator !== 'undefined' && navigator.onLine === false) {
			res.gagal += programIds.length - i;
			break;
		}
		try {
			const detail = await fetchDetail(programIds[i]);
			if (hasOfflineReadableContent(detail)) {
				await cacheKursusDetail(detail);
				res.tersimpan++;
			} else {
				res.dilewati++;
			}
		} catch {
			res.gagal++;
		}
		onProgress?.(i + 1, programIds.length);
	}
	return res;
}

// --- Daftar kursus (agar halaman daftar tetap bisa dibuka tanpa sinyal) ---
const LIST_KEY = 'epi_kursus_list_v1';
const LIST_MAX_ITEMS = 40;

/** Simpan daftar kursus yang diikuti (bukan seluruh katalog) — kecil & cukup untuk membuka kursus offline. */
export function cacheKursusList<T extends { terdaftar: boolean }>(kursus: T[], pilar: unknown[] = []): void {
	try {
		const mine = (Array.isArray(kursus) ? kursus : []).filter((k) => k?.terdaftar).slice(0, LIST_MAX_ITEMS);
		localStorage.setItem(LIST_KEY, JSON.stringify({ at: new Date().toISOString(), kursus: mine, pilar }));
	} catch {
		/* penyimpanan penuh/diblokir: abaikan */
	}
}

export function getCachedKursusList<T = unknown>(): { at: string; kursus: T[]; pilar: unknown[] } | null {
	try {
		const raw = localStorage.getItem(LIST_KEY);
		if (!raw) return null;
		const p = JSON.parse(raw);
		if (!p || !Array.isArray(p.kursus) || !isCacheFresh(String(p.at))) return null;
		return { at: String(p.at), kursus: p.kursus as T[], pilar: Array.isArray(p.pilar) ? p.pilar : [] };
	} catch {
		return null;
	}
}
