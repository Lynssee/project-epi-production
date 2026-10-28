// src/lib/utils/draftStorage.ts
// Lapisan penyimpanan draf v2 (Fase 1, rencana Draf Otomatis Universal & Anti-White-Screen).
// Dipakai oleh formPersist.ts (Lapis 2) dan nanti autoDraft.ts (Lapis 1, Fase 3).
//
// Beda dari sessionStorage lama:
// - localStorage, bukan sessionStorage → draf tahan tutup-tab (K1).
// - Kunci ber-userId → draf operator A tidak muncul di form operator B (K1, mitigasi
//   "risiko privasi" §0.6 dari dokumen rencana).
// - TTL per-scope, dicek saat baca (bukan timer) — draf basi otomatis dianggap tidak ada.
// - Denylist field sensitif (regex nama key) dibuang SEBELUM ditulis ke localStorage (K3).
//   Field yang kena denylist tidak pernah menyentuh localStorage sama sekali.
// - Batas LRU: maks MAX_SCOPES scope, maks MAX_SCOPE_BYTES per scope, anggaran total
//   TOTAL_BUDGET_BYTES — scope paling lama tidak disentuh dibuang duluan.
//
// TTL/denylist/batas masih hardcode di sini (default yang disepakati, bukan diagram
// keputusan baru) — dipindah ke app_settings (bisa diatur admin lewat UI) di Fase 6
// sesuai rencana §6. Jangan buat mesin ke-3: ini SATU-SATUNYA lapisan penyimpanan draf,
// formPersist.ts hanya membungkus API-nya.

const INDEX_KEY = 'draft:__index__';

/** ms — dipakai kalau caller tidak memberi ttlMs sendiri. */
export const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 hari (lapangan)

const MAX_SCOPES = 30;
const MAX_SCOPE_BYTES = 512 * 1024; // 512KB per scope
const TOTAL_BUDGET_BYTES = 4 * 1024 * 1024; // 4MB total

// Regex pada NAMA KEY objek snapshot (bukan isi), case-insensitive. Field yang cocok
// dibuang total dari draf — user harus isi ulang bagian ini setelah tab ditutup.
const DENYLIST_KEY_RE =
	/(password|pin|token|otp|nik|ktp|npwp|no_?rekening|rekening|gaji|salary|upah|thp|cvv|kartu)/i;

interface DraftEnvelope<T> {
	data: T;
	savedAt: number;
	ttlMs: number;
}

interface IndexEntry {
	storageKey: string;
	savedAt: number;
	sizeBytes: number;
}

function hasLocalStorage(): boolean {
	return typeof localStorage !== 'undefined';
}

/** Buang key yang cocok denylist, rekursif ke object/array bersarang. Tidak mutasi input. */
export function sanitizeForDraft<T>(value: T): T {
	if (value === null || typeof value !== 'object') return value;
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeForDraft(item)) as unknown as T;
	}
	if (value instanceof Blob || value instanceof File) return value;
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		if (DENYLIST_KEY_RE.test(k)) continue;
		out[k] = sanitizeForDraft(v);
	}
	return out as T;
}

function loadIndex(): IndexEntry[] {
	if (!hasLocalStorage()) return [];
	try {
		const raw = localStorage.getItem(INDEX_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function saveIndex(entries: IndexEntry[]) {
	if (!hasLocalStorage()) return;
	try {
		localStorage.setItem(INDEX_KEY, JSON.stringify(entries));
	} catch {
		// index gagal tersimpan — bukan fatal, LRU jadi kurang akurat sampai ditulis lagi
	}
}

function touchIndex(storageKey: string, sizeBytes: number) {
	const entries = loadIndex().filter((e) => e.storageKey !== storageKey);
	entries.push({ storageKey, savedAt: Date.now(), sizeBytes });
	enforceLimits(entries);
}

function dropFromIndex(storageKey: string) {
	saveIndex(loadIndex().filter((e) => e.storageKey !== storageKey));
}

/** Buang scope paling lama (LRU) sampai di bawah MAX_SCOPES dan TOTAL_BUDGET_BYTES. */
function enforceLimits(entries: IndexEntry[]) {
	let list = [...entries].sort((a, b) => a.savedAt - b.savedAt); // tertua dulu
	const totalBytes = () => list.reduce((sum, e) => sum + e.sizeBytes, 0);
	while (list.length > MAX_SCOPES || totalBytes() > TOTAL_BUDGET_BYTES) {
		const oldest = list.shift();
		if (!oldest) break;
		if (hasLocalStorage()) {
			try {
				localStorage.removeItem(oldest.storageKey);
			} catch {
				// abaikan
			}
		}
	}
	saveIndex(list);
}

/** Baca draf. null bila tidak ada, sudah kedaluwarsa (TTL), atau localStorage tak tersedia. */
export function readEnvelope<T>(storageKey: string): T | null {
	if (!hasLocalStorage()) return null;
	try {
		const raw = localStorage.getItem(storageKey);
		if (!raw) return null;
		const envelope = JSON.parse(raw) as DraftEnvelope<T>;
		if (Date.now() - envelope.savedAt > envelope.ttlMs) {
			localStorage.removeItem(storageKey);
			dropFromIndex(storageKey);
			return null;
		}
		return envelope.data;
	} catch {
		return null;
	}
}

/** Kapan draf ini terakhir disimpan (epoch ms), atau null kalau tidak ada/rusak. */
export function readSavedAt(storageKey: string): number | null {
	if (!hasLocalStorage()) return null;
	try {
		const raw = localStorage.getItem(storageKey);
		if (!raw) return null;
		const envelope = JSON.parse(raw) as DraftEnvelope<unknown>;
		return envelope.savedAt ?? null;
	} catch {
		return null;
	}
}

/**
 * Tulis draf. Field yang cocok denylist dibuang duluan (sanitizeForDraft). Kalau ukuran
 * setelah sanitasi melebihi MAX_SCOPE_BYTES, penulisan dibatalkan (bukan dipotong diam-diam
 * — draf lama tetap ada sampai TTL habis, lebih aman daripada draf setengah tersimpan).
 */
export function writeEnvelope<T>(storageKey: string, data: T, ttlMs: number = DEFAULT_TTL_MS) {
	if (!hasLocalStorage()) return;
	try {
		const sanitized = sanitizeForDraft(data);
		const envelope: DraftEnvelope<T> = { data: sanitized, savedAt: Date.now(), ttlMs };
		const serialized = JSON.stringify(envelope);
		const sizeBytes = new Blob([serialized]).size;
		if (sizeBytes > MAX_SCOPE_BYTES) {
			console.warn(
				`[draftStorage] Draf "${storageKey}" (${sizeBytes} byte) melebihi batas ${MAX_SCOPE_BYTES} byte — tidak disimpan.`
			);
			return;
		}
		localStorage.setItem(storageKey, serialized);
		touchIndex(storageKey, sizeBytes);
	} catch (e) {
		// localStorage penuh/private mode — draf gagal tersimpan, bukan fatal.
		console.warn('[draftStorage] Gagal menyimpan draf:', e);
	}
}

export function removeEnvelope(storageKey: string) {
	if (!hasLocalStorage()) return;
	try {
		localStorage.removeItem(storageKey);
	} catch {
		// abaikan
	}
	dropFromIndex(storageKey);
}

/**
 * Migrasi draf lama dari sessionStorage (skema Fase <1: kunci `draft:<key>`, tanpa TTL
 * eksplisit di envelope — pakai ttlMenit terpisah) ke localStorage kunci baru. Dipanggil
 * sekali per restore(); no-op kalau tidak ada draf lama.
 */
export function migrateLegacySessionDraft<T>(
	legacyStorageKey: string,
	newStorageKey: string,
	ttlMs: number
) {
	if (typeof sessionStorage === 'undefined') return;
	try {
		const raw = sessionStorage.getItem(legacyStorageKey);
		if (!raw) return;
		const legacy = JSON.parse(raw) as { data: T; savedAt: number };
		writeEnvelope(newStorageKey, legacy.data, ttlMs);
		sessionStorage.removeItem(legacyStorageKey);
	} catch {
		// draf lama rusak/tidak terbaca — abaikan, bukan fatal
	}
}

/** Untuk Pusat Draf Tersimpan (Fase 4) & purge saat logout (Fase 6). */
export function listAllScopes(): IndexEntry[] {
	return loadIndex();
}

export function clearAllScopesForPrefix(prefix: string) {
	const entries = loadIndex();
	for (const e of entries) {
		if (e.storageKey.startsWith(prefix)) removeEnvelope(e.storageKey);
	}
}
