// src/lib/services/inventoryPocketGuide.ts
// Inventory 360° Fase D — "Pocket Guide" offline untuk dashboard lapangan.
//
// Kartu Pengetahuan yang pernah dimuat disimpan ringkas di HP (localStorage) sehingga saat sinyal hilang di site,
// pindai QR barang (EPI:ITEM:<id>) atau buka kartu tetap menampilkan panduan pakai, APD, dan tanda harus ganti.
//
// Modul MURNI: penyimpanan diinjeksikan (mudah dites, aman di SSR). Prinsip:
//  - hanya kartu yang punya profil yang disimpan; tanpa rupiah / data pribadi; foto & berkas tidak disimpan,
//  - template disimpan sekali per id (bukan per barang) agar hemat kuota penyimpanan,
//  - LRU berdasar waktu simpan, dibatasi jumlah barang & umur; kuota penuh → buang yang terlama lalu coba lagi,
//  - kegagalan penyimpanan TIDAK PERNAH mengganggu alur lapangan (dilog, bukan dilempar),
//  - kartu offline selalu ditandai (offline.at) supaya UI memberi tahu bahwa isinya mungkin bukan versi terbaru.

export const POCKET_STORAGE_KEY = 'inv360.pocket.v1';
export const POCKET_DEFAULT_MAX_ITEMS = 80;
export const POCKET_DEFAULT_MAX_AGE_DAYS = 30;

export interface PocketStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem?(key: string): void;
}

type AnyCard = {
	itemId: number;
	source: 'item' | 'group' | 'none';
	profile: Record<string, any> | null;
	template: Record<string, any> | null;
	groupId: string | null;
	href: string;
	offline?: { at: number };
};

type PocketEntry = { at: number; card: Omit<AnyCard, 'template'> & { templateId: number | null } };
type PocketData = { v: 1; items: Record<string, PocketEntry>; templates: Record<string, Record<string, any>> };

/** Bidang profil yang dipakai tampilan kartu (lihat inventoryKnowledgeView). Foto/berkas/jejak verifikasi tidak ikut. */
const PROFILE_KEEP = [
	'id', 'status', 'sumber_data', 'is_kritis', 'wajib_training', 'training_program_id', 'review_due_date', 'skor_kelengkapan',
	'ringkasan', 'fungsi_utama', 'cara_kerja', 'dipakai_pada', 'spec_values', 'spec_baik', 'panduan_beli', 'panduan_pakai',
	'risiko_salah', 'decision_rules', 'apd', 'bahaya'
] as const;
const TEMPLATE_KEEP = ['id', 'nama', 'spec_fields', 'sections_aktif', 'context_map', 'min_score_verified', 'is_kritis_default', 'status', 'parent_category_id', 'sub_category_id'] as const;

const pick = (obj: Record<string, any> | null | undefined, keys: readonly string[]) => {
	const out: Record<string, any> = {};
	for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
	return out;
};

const empty = (): PocketData => ({ v: 1, items: {}, templates: {} });

function read(storage: PocketStorage | null): PocketData {
	if (!storage) return empty();
	try {
		const parsed = JSON.parse(storage.getItem(POCKET_STORAGE_KEY) || 'null');
		if (parsed && parsed.v === 1 && parsed.items && typeof parsed.items === 'object') {
			return { v: 1, items: parsed.items, templates: parsed.templates && typeof parsed.templates === 'object' ? parsed.templates : {} };
		}
	} catch {
		/* data rusak → mulai kosong */
	}
	return empty();
}

/** Buang entri melewati umur & kelebihan jumlah (LRU: yang paling lama disimpan dulu), lalu template yatim. */
export function prunePocket(data: PocketData, now: number, maxItems: number, maxAgeDays: number): PocketData {
	const maxAgeMs = Math.max(0, maxAgeDays) * 86400000;
	const alive = Object.entries(data.items)
		.filter(([, e]) => e && typeof e.at === 'number' && (maxAgeMs === 0 || now - e.at <= maxAgeMs))
		.sort((a, b) => b[1].at - a[1].at)
		.slice(0, Math.max(0, maxItems));
	const items = Object.fromEntries(alive);
	const used = new Set(alive.map(([, e]) => String(e.card?.templateId)));
	const templates = Object.fromEntries(Object.entries(data.templates).filter(([id]) => used.has(id)));
	return { v: 1, items, templates };
}

export function createPocketGuide(storage: PocketStorage | null, opts: { maxItems?: number; maxAgeDays?: number; now?: () => number } = {}) {
	const now = opts.now ?? Date.now;
	const maxItems = Math.max(1, Math.floor(opts.maxItems ?? POCKET_DEFAULT_MAX_ITEMS));
	const maxAgeDays = Math.max(0, opts.maxAgeDays ?? POCKET_DEFAULT_MAX_AGE_DAYS);

	function write(data: PocketData): boolean {
		if (!storage) return false;
		try {
			storage.setItem(POCKET_STORAGE_KEY, JSON.stringify(data));
			return true;
		} catch (e) {
			console.warn('[pocketGuide] penyimpanan HP penuh/ditolak:', e);
			return false;
		}
	}

	return {
		/** Simpan banyak kartu sekaligus (satu tulis). Kartu tanpa profil dilewati. Mengembalikan jumlah yang disimpan. */
		saveMany(cards: Array<AnyCard | null | undefined>): number {
			if (!storage) return 0;
			const data = read(storage);
			const t = now();
			let saved = 0;
			for (const card of cards) {
				if (!card?.profile || card.offline) continue; // jangan menyimpan ulang salinan offline sebagai "baru"
				const template = card.template ? pick(card.template, TEMPLATE_KEEP) : null;
				const templateId = template?.id ?? null;
				if (template && templateId != null) data.templates[String(templateId)] = template;
				data.items[String(card.itemId)] = {
					at: t,
					card: { itemId: card.itemId, source: card.source, groupId: card.groupId, href: card.href, profile: pick(card.profile, PROFILE_KEEP), templateId }
				};
				saved += 1;
			}
			if (!saved) return 0;
			let pruned = prunePocket(data, t, maxItems, maxAgeDays);
			if (!write(pruned)) {
				// Kuota penuh: sisakan separuh yang terbaru lalu coba sekali lagi.
				pruned = prunePocket(pruned, t, Math.max(1, Math.floor(maxItems / 2)), maxAgeDays);
				if (!write(pruned)) return 0;
			}
			return saved;
		},

		/** Kartu tersimpan (ditandai offline.at), atau null bila tidak ada / sudah kedaluwarsa. */
		get(itemId: number | string): AnyCard | null {
			const data = read(storage);
			const e = data.items[String(itemId)];
			if (!e) return null;
			const maxAgeMs = maxAgeDays * 86400000;
			if (maxAgeMs > 0 && now() - e.at > maxAgeMs) return null;
			const { templateId, ...rest } = e.card;
			return { ...rest, template: templateId != null ? data.templates[String(templateId)] ?? null : null, offline: { at: e.at } } as AnyCard;
		},

		stats(): { items: number; oldest: number | null; newest: number | null } {
			const ats = Object.values(read(storage).items).map((e) => e.at);
			return { items: ats.length, oldest: ats.length ? Math.min(...ats) : null, newest: ats.length ? Math.max(...ats) : null };
		},

		clear(): void {
			try {
				storage?.removeItem?.(POCKET_STORAGE_KEY);
			} catch (e) {
				console.warn('[pocketGuide] gagal menghapus panduan offline:', e);
			}
		}
	};
}

/** Storage nyata di browser, atau null (SSR / diblokir). */
export function browserPocketStorage(): PocketStorage | null {
	try {
		return typeof localStorage !== 'undefined' ? localStorage : null;
	} catch {
		return null;
	}
}

export const POCKET_FRESH_HOURS = 6;

/**
 * Rencana pra-muat massal ("Unduh panduan proyek"): urutan `itemIds` = prioritas (yang paling relevan dulu).
 *  - duplikat & id tak valid dibuang,
 *  - dipangkas ke `maxItems` (sisanya tak akan muat di HP; tidak perlu diunduh -> hemat request),
 *  - yang salinannya masih segar (disimpan < POCKET_FRESH_HOURS jam lalu) dilewati.
 */
export function planPrefetch(
	itemIds: Array<number | string | null | undefined>,
	maxItems: number,
	freshAt: (id: number) => number | null,
	now: number = Date.now()
): { toFetch: number[]; trimmed: number; skippedFresh: number } {
	const seen = new Set<number>();
	const ids: number[] = [];
	for (const raw of itemIds) {
		const n = Number(raw);
		if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
		seen.add(n);
		ids.push(n);
	}
	const cap = Math.max(1, Math.floor(maxItems));
	const kept = ids.slice(0, cap);
	const freshMs = POCKET_FRESH_HOURS * 3600000;
	const toFetch: number[] = [];
	let skippedFresh = 0;
	for (const id of kept) {
		const at = freshAt(id);
		if (at != null && now - at < freshMs) skippedFresh += 1;
		else toFetch.push(id);
	}
	return { toFetch, trimmed: ids.length - kept.length, skippedFresh };
}
