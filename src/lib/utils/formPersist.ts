// src/lib/utils/formPersist.ts
// Penyelamat draf form (rencana v2, Fase 1): tutup tab tak sengaja tidak boleh
// menghilangkan isian user — termasuk kalau tab BENAR-BENAR ditutup, bukan cuma
// reload/crash. Sebelum Fase 1 ini memakai sessionStorage (hilang saat tab ditutup);
// dibalik ke localStorage per keputusan K1 (lihat dokumen rencana §10.A).
//
// API di bawah ini SENGAJA dipertahankan sama persis dengan versi sebelumnya (hanya
// ditambah savedAt(), aditif) — 41 file pemakai (createFormPersist,
// registerFormPersistSaveTriggers) tidak perlu disentuh. Isi penyimpanannya sekarang
// dibungkus lewat draftStorage.ts: localStorage + TTL + kunci ber-userId + denylist
// field sensitif + batas LRU, bukan ditulis manual di sini.
//
// Foto (Blob) tetap di IndexedDB lewat idb — TIDAK dipindah ke localStorage (kuota kecil
// + bukan string). Kunci foto ikut mewarisi userId dari storageKey.
import { openDB, type IDBPDatabase } from 'idb';
import { get } from 'svelte/store';
import { authStore } from '$lib/stores/auth';
import {
	DEFAULT_TTL_MS,
	migrateLegacySessionDraft,
	readEnvelope,
	readSavedAt,
	removeEnvelope,
	writeEnvelope
} from './draftStorage';

const PHOTO_DB_NAME = 'epi_form_draft_photos';
const PHOTO_STORE_NAME = 'photos';

let photoDbPromise: Promise<IDBPDatabase> | null = null;

function getPhotoDb(): Promise<IDBPDatabase> {
	if (typeof indexedDB === 'undefined') {
		throw new Error('IndexedDB tidak tersedia di perangkat ini');
	}
	if (!photoDbPromise) {
		photoDbPromise = openDB(PHOTO_DB_NAME, 1, {
			upgrade(db) {
				if (!db.objectStoreNames.contains(PHOTO_STORE_NAME)) {
					db.createObjectStore(PHOTO_STORE_NAME);
				}
			}
		});
	}
	return photoDbPromise;
}

function currentUserId(): string {
	return get(authStore).user?.uid || 'anon';
}

export interface FormPersist<T> {
	/** Tulis draf dengan jeda (debounce 500ms) — dipanggil tiap ketikan/perubahan form. */
	save(data: T): void;
	/** Baca draf tersimpan. null bila tidak ada atau sudah kedaluwarsa (TTL). */
	restore(): T | null;
	/** Jam draf terakhir disimpan (epoch ms), atau null. Untuk banner pemulihan. */
	savedAt(): number | null;
	/** Hapus draf (dipanggil setelah submit berhasil). */
	clear(): void;
	/** Tulis draf SEKARANG (synchronous, tanpa debounce) — dipanggil tepat sebelum kamera dibuka. */
	flushNow(data: T): void;
	/** Simpan foto (Blob) ke IndexedDB dengan kunci lokal terhadap draf ini. */
	savePhoto(photoKey: string, blob: Blob): Promise<void>;
	/** Ambil kembali foto tersimpan, atau null bila tidak ada / IndexedDB tak tersedia. */
	restorePhoto(photoKey: string): Promise<Blob | null>;
	/**
	 * Hapus SATU foto milik draf ini. Dipakai di halaman dengan beberapa form/foto
	 * terpisah (mis. Cek Kendaraan: foto temuan P2H & struk BBM), di mana submit salah
	 * satu form tidak boleh ikut menghapus foto milik form yang lain.
	 */
	clearPhoto(photoKey: string): Promise<void>;
	/** Hapus semua foto milik draf ini dari IndexedDB. */
	clearPhotos(): Promise<void>;
}

export function createFormPersist<T>(key: string, opts?: { ttlMenit?: number }): FormPersist<T> {
	const legacyStorageKey = `draft:${key}`;
	const ttlMs = opts?.ttlMenit ? opts.ttlMenit * 60 * 1000 : DEFAULT_TTL_MS;
	let debounceId: ReturnType<typeof setTimeout> | null = null;
	// userId di-resolve tiap panggilan (bukan sekali di createFormPersist) karena
	// createFormPersist bisa dipanggil di top-level modul sebelum authStore terisi.
	const storageKey = () => `draft:${key}:${currentUserId()}`;

	function migrateIfNeeded() {
		migrateLegacySessionDraft<T>(legacyStorageKey, storageKey(), ttlMs);
	}

	function writeNow(data: T) {
		writeEnvelope(storageKey(), data, ttlMs);
	}

	function save(data: T) {
		if (debounceId) clearTimeout(debounceId);
		debounceId = setTimeout(() => writeNow(data), 500);
	}

	function flushNow(data: T) {
		if (debounceId) {
			clearTimeout(debounceId);
			debounceId = null;
		}
		writeNow(data);
	}

	function restore(): T | null {
		migrateIfNeeded();
		return readEnvelope<T>(storageKey());
	}

	function savedAt(): number | null {
		return readSavedAt(storageKey());
	}

	function clear() {
		if (debounceId) {
			clearTimeout(debounceId);
			debounceId = null;
		}
		removeEnvelope(storageKey());
	}

	async function savePhoto(photoKey: string, blob: Blob) {
		try {
			const db = await getPhotoDb();
			await db.put(PHOTO_STORE_NAME, blob, `${storageKey()}:${photoKey}`);
		} catch {
			// IndexedDB gagal (kuota/privat) — foto draf hilang, tapi bukan fatal.
		}
	}

	async function restorePhoto(photoKey: string): Promise<Blob | null> {
		try {
			const db = await getPhotoDb();
			const blob = await db.get(PHOTO_STORE_NAME, `${storageKey()}:${photoKey}`);
			return blob ?? null;
		} catch {
			return null;
		}
	}

	async function clearPhoto(photoKey: string) {
		try {
			const db = await getPhotoDb();
			await db.delete(PHOTO_STORE_NAME, `${storageKey()}:${photoKey}`);
		} catch {
			// abaikan — foto lama akan tertimpa/kedaluwarsa dengan sendirinya
		}
	}

	async function clearPhotos() {
		try {
			const db = await getPhotoDb();
			const prefix = `${storageKey()}:`;
			const keys = await db.getAllKeys(PHOTO_STORE_NAME);
			for (const k of keys) {
				if (typeof k === 'string' && k.startsWith(prefix)) {
					await db.delete(PHOTO_STORE_NAME, k);
				}
			}
		} catch {
			// abaikan — foto lama akan tertimpa/kedaluwarsa dengan sendirinya
		}
	}

	return {
		save,
		restore,
		savedAt,
		clear,
		flushNow,
		savePhoto,
		restorePhoto,
		clearPhoto,
		clearPhotos
	};
}

/**
 * Daftarkan titik simpan wajib: pagehide & visibilitychange (BUKAN beforeunload — tidak
 * diandalkan di Android saat OS mematikan tab karena RAM habis). Panggil sekali per halaman
 * di dalam $effect; getSnapshot mengembalikan state form terkini setiap kali dipanggil.
 * Mengembalikan fungsi cleanup untuk dipanggil di $effect return.
 */
export function registerFormPersistSaveTriggers<T>(
	persist: FormPersist<T>,
	getSnapshot: () => T
): () => void {
	if (typeof window === 'undefined') return () => {};
	const flush = () => persist.flushNow(getSnapshot());
	const onVisibility = () => {
		if (document.visibilityState === 'hidden') flush();
	};
	window.addEventListener('pagehide', flush);
	document.addEventListener('visibilitychange', onVisibility);
	return () => {
		window.removeEventListener('pagehide', flush);
		document.removeEventListener('visibilitychange', onVisibility);
	};
}
