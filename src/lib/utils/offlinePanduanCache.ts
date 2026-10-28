// src/lib/utils/offlinePanduanCache.ts
// §7B #1 (implementation_plan_panduan + video generator.md — rekomendasi
// dashboard lapangan): cache respons /api/tutorial/for-me (peta jabatan→modul
// wajib + katalog video aktif) di IndexedDB, supaya checklist "Bantuan" tetap
// tampil saat sinyal lapangan buruk/putus. Pola sama offlineSopCache.ts.
//
// Konten TEKS panduan.langkah[].isi TIDAK perlu di-cache di sini — sudah
// dibundel langsung ke JS ($lib/data/panduan.ts, tanpa fetch jaringan), jadi
// otomatis tersedia offline selama app shell sudah pernah dimuat. Yang perlu
// di-cache HANYA bagian yang datang dari network: peta modul wajib per
// jabatan + katalog video. Progress TIDAK di-cache (berubah-ubah, dan
// menampilkan progress basi lebih menyesatkan daripada tidak menampilkannya).
//
// Video itu sendiri (streaming YouTube/self-hosted) TETAP butuh koneksi —
// tidak ada cara sungguhan memutar video offline tanpa mengunduh berkasnya
// penuh (di luar cakupan). Thumbnail YouTube (img.youtube.com) juga tetap
// bergantung jaringan CDN eksternal saat benar-benar offline; TidakLayak
// di-cache sebagai blob di sini karena tak akan pernah bisa diandalkan
// sepenuhnya tanpa sinyal sama sekali.

import { openDB, type IDBPDatabase } from 'idb';
import type { TutorialForMe } from '$lib/services/tutorialApi';

const DB_NAME = 'epi_panduan_cache';
const FOR_ME_STORE = 'cached_for_me';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
	if (typeof indexedDB === 'undefined') {
		throw new Error('IndexedDB tidak tersedia di perangkat ini');
	}
	if (!dbPromise) {
		dbPromise = openDB(DB_NAME, 1, {
			upgrade(db) {
				if (!db.objectStoreNames.contains(FOR_ME_STORE)) db.createObjectStore(FOR_ME_STORE, { keyPath: 'key' });
			}
		});
	}
	return dbPromise;
}

export interface CachedTutorialForMe {
	roleMap: TutorialForMe['roleMap'];
	videos: TutorialForMe['videos'];
	cachedAt: string;
}

/** Simpan roleMap+videos (BUKAN progress) saat berhasil fetch online. */
export async function cacheTutorialForMe(data: TutorialForMe): Promise<void> {
	try {
		const db = await getDb();
		await db.put(FOR_ME_STORE, {
			key: 'latest',
			roleMap: data.roleMap,
			videos: data.videos,
			cachedAt: new Date().toISOString()
		} satisfies CachedTutorialForMe & { key: string });
	} catch {
		/* non-fatal: cache adalah kenyamanan, bukan sumber kebenaran */
	}
}

/** Ambil cache terakhir — dipakai sebagai fallback saat fetch /for-me gagal (offline/sinyal buruk). */
export async function getCachedTutorialForMe(): Promise<CachedTutorialForMe | null> {
	try {
		const db = await getDb();
		const row = await db.get(FOR_ME_STORE, 'latest');
		return row || null;
	} catch {
		return null;
	}
}
