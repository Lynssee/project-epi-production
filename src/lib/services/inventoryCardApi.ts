// src/lib/services/inventoryCardApi.ts
// Inventory 360° Fase 4 — data Kartu Pengetahuan untuk DASHBOARD LAPANGAN.
//
// Hemat API & hemat baterai/kuota (HP di lapangan): kartu banyak di satu layar TIDAK menembak banyak request —
//  - getKnowledgeCard(id) dikumpulkan ~40 ms lalu diambil sekali per batch,
//  - cache 2 menit (template 5 menit),
//  - logika ambil data = inventory360/inventoryKnowledgeCardCore.js (BYTE-IDENTIK dengan erp-epi, dijaga tes kontrak).
// Lapangan hanya MEMBACA profil; mengisi/memverifikasi profil tetap di dashboard admin (Inventory 360°).
// Error TIDAK ditelan: promise ditolak, komponen menampilkan pesan & mencatat ke console.

import { secureDirectusJson, getIdToken } from './secureDirectus';
import { loadInventorySettings } from './inventorySettings';
import { auth } from '$lib/firebase';
import { createTouchTracker } from './inventory360/inventoryKnowledgeTouch.js';
import { buildInspectionItems, formatInspectionNote } from './inventory360/inventoryKnowledgeInspection.js';
import { FEEDBACK_COLLECTION, validateFeedback, buildFeedbackRow, feedbackDedupeKey } from './inventory360/inventoryKnowledgeFeedback.js';
import { fetchCardsWith, fetchTemplatesWith } from './inventory360/inventoryKnowledgeCardCore.js';
import { createPocketGuide, browserPocketStorage, planPrefetch, POCKET_DEFAULT_MAX_ITEMS, POCKET_DEFAULT_MAX_AGE_DAYS } from './inventoryPocketGuide';

export type KnowledgeCardData = {
	itemId: number;
	source: 'item' | 'group' | 'none';
	profile: any | null;
	template: any | null;
	groupId: string | null;
	href: string;
	/** Terisi bila kartu ini salinan Pocket Guide (HP) karena data terbaru tak bisa dimuat; `at` = ms waktu tersimpan. */
	offline?: { at: number };
};

const CARD_TTL_MS = 2 * 60 * 1000;
const TEMPLATE_TTL_MS = 5 * 60 * 1000;
const BATCH_DELAY_MS = 40;
const BATCH_SIZE = 100;

const cardCache = new Map<number, { at: number; card: KnowledgeCardData | null }>();
let templatesCache: { at: number; list: any[] } | null = null;
let queue = new Map<number, Array<{ resolve: (c: KnowledgeCardData | null) => void; reject: (e: unknown) => void }>>();
let timer: ReturnType<typeof setTimeout> | null = null;

async function getTemplates(): Promise<any[]> {
	if (templatesCache && Date.now() - templatesCache.at < TEMPLATE_TTL_MS) return templatesCache.list;
	const list = await fetchTemplatesWith(secureDirectusJson);
	templatesCache = { at: Date.now(), list };
	return list;
}

// ─── Pocket Guide offline (Fase D) ───────────────────────────────────────────────────────────────
// Konfigurasi terakhir yang diketahui disimpan di memori: saat OFFLINE kita tak boleh menunggu loadInventorySettings().
let pocketCfg = { enabled: true, maxItems: POCKET_DEFAULT_MAX_ITEMS, maxAgeDays: POCKET_DEFAULT_MAX_AGE_DAYS };

async function savePocket(cards: Array<KnowledgeCardData | null>): Promise<void> {
	try {
		const s = await loadInventorySettings();
		pocketCfg = {
			enabled: s['inventory.knowledge.pocket_offline_aktif'] !== false,
			maxItems: Number(s['inventory.knowledge.pocket_maks_item']) || POCKET_DEFAULT_MAX_ITEMS,
			maxAgeDays: Number(s['inventory.knowledge.pocket_umur_maks_hari'] ?? POCKET_DEFAULT_MAX_AGE_DAYS)
		};
		if (!pocketCfg.enabled) return;
		createPocketGuide(browserPocketStorage(), pocketCfg).saveMany(cards);
	} catch (e) {
		console.warn('[inventoryCardApi] Pocket Guide tidak tersimpan (diabaikan):', e);
	}
}

function pocketFallback(id: number): KnowledgeCardData | null {
	if (!pocketCfg.enabled) return null;
	return createPocketGuide(browserPocketStorage(), pocketCfg).get(id) as KnowledgeCardData | null;
}

async function flush() {
	timer = null;
	const batch = queue;
	queue = new Map();
	const ids = [...batch.keys()];
	for (let i = 0; i < ids.length; i += BATCH_SIZE) {
		const chunk = ids.slice(i, i + BATCH_SIZE);
		try {
			const cards = await fetchCardsWith({ fetchJson: secureDirectusJson, loadTemplates: getTemplates }, chunk);
			for (const id of chunk) {
				const card = (cards.get(id) as KnowledgeCardData | undefined) || null;
				cardCache.set(id, { at: Date.now(), card });
				for (const w of batch.get(id) || []) w.resolve(card);
			}
			void savePocket(chunk.map((id) => (cards.get(id) as KnowledgeCardData | undefined) || null));
		} catch (e) {
			// Gagal memuat (umumnya tanpa sinyal): pakai salinan Pocket Guide bila ada; tidak di-cache agar dicoba lagi saat online.
			console.warn('[inventoryCardApi] kartu terbaru gagal dimuat — mencoba Pocket Guide offline:', e);
			for (const id of chunk) {
				const hit = pocketFallback(id);
				for (const w of batch.get(id) || []) (hit ? w.resolve(hit) : w.reject(e));
			}
		}
	}
}

/** Kartu satu barang. Pemanggilan berdekatan digabung jadi satu batch request. */
export function getKnowledgeCard(itemId: number | string | null | undefined): Promise<KnowledgeCardData | null> {
	const id = Number(itemId);
	if (!Number.isFinite(id) || id <= 0) return Promise.resolve(null);
	const hit = cardCache.get(id);
	if (hit && Date.now() - hit.at < CARD_TTL_MS) return Promise.resolve(hit.card);
	return new Promise((resolve, reject) => {
		const waiters = queue.get(id) || [];
		waiters.push({ resolve, reject });
		queue.set(id, waiters);
		if (!timer) timer = setTimeout(flush, BATCH_DELAY_MS);
	});
}

/** Apakah konteks ini aktif? Dikontrol superadmin di /settings/inventory (erp-epi). Gagal muat setelan → default (aktif). */
export async function isCardContextEnabled(context: string): Promise<boolean> {
	const s = await loadInventorySettings();
	const aktif = s['inventory.knowledge.touchpoint_aktif'];
	return Array.isArray(aktif) ? aktif.includes(context) : true;
}

// ─── Statistik penggunaan (Fase 7) ───────────────────────────────────────────────────────────────
// Satu baris per (hari, konteks, barang) per sesi, dikirim berkelompok ke erp-epi (dashboard Kesehatan Data 360°).
const tracker = createTouchTracker({
	send: (rows: unknown[]) => secureDirectusJson('/items/inventory_knowledge_touch', { method: 'POST', body: JSON.stringify(rows) })
});
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => void tracker.flush());

/** Catat bahwa Kartu dibuka. Tidak pernah melempar; mati bila setelan statistik_aktif=false. */
export async function trackCardOpen(itemId: number | string | null | undefined, context: string): Promise<void> {
	try {
		const s = await loadInventorySettings();
		if (s['inventory.knowledge.statistik_aktif'] === false) return;
		tracker.track({ itemId: itemId as number, context, sumber: 'lapangan', userEmail: auth?.currentUser?.email ?? null });
	} catch (e) {
		console.error('[inventoryCardApi] gagal mencatat statistik buka kartu (diabaikan):', e);
	}
}

// ─── Laporan "data spek berbeda di lapangan" (Fase B) ────────────────────────────────────────────
// Menulis ke koleksi inventory_knowledge_feedback; dashboard admin menampilkan banner & antrean tinjauan.
// Tidak mengubah status profil. Satu laporan per (barang, jenis) per sesi — cegah ketuk ganda.
const sentFeedback = new Set<string>();

/** Apakah tombol laporan ditampilkan? Dikontrol superadmin (setelan laporan_lapangan_aktif). */
export async function isFeedbackEnabled(): Promise<boolean> {
	const s = await loadInventorySettings();
	return s['inventory.knowledge.laporan_lapangan_aktif'] === true; // mati bawaan sampai skema Directus dibuat
}

/** Kirim laporan. Melempar Error berisi pesan yang bisa ditampilkan ke pengguna. */
export async function submitCardFeedback(p: {
	itemId: number | string;
	profileId?: number | null;
	jenis: string;
	catatan?: string;
	context?: string;
}): Promise<void> {
	const errors = validateFeedback({ itemId: p.itemId, jenis: p.jenis, catatan: p.catatan });
	if (errors.length) throw new Error(errors.join(' '));
	const key = feedbackDedupeKey(p.itemId, p.jenis);
	if (sentFeedback.has(key)) throw new Error('Laporan yang sama sudah terkirim. Terima kasih.');
	const row = buildFeedbackRow({
		itemId: p.itemId,
		profileId: p.profileId ?? null,
		jenis: p.jenis,
		catatan: p.catatan,
		konteks: p.context ?? null,
		pelaporEmail: auth?.currentUser?.email ?? null
	});
	try {
		await secureDirectusJson(`/items/${FEEDBACK_COLLECTION}`, { method: 'POST', body: JSON.stringify(row) });
	} catch (e) {
		console.error('[inventoryCardApi] gagal mengirim laporan spek berbeda:', e);
		throw new Error('Laporan belum bisa dikirim (fitur belum aktif di server atau jaringan bermasalah). Beritahu admin Inventory secara langsung.');
	}
	sentFeedback.add(key);
}

// ─── Checklist inspeksi terima (Fase C) ──────────────────────────────────────────────────────────
// Status centang disimpan per barang di sessionStorage (selamat dari refresh halaman, hilang saat tab ditutup) beserta satu
// baris ringkasan yang ditempel ke catatan penerimaan. Alat bantu: tidak pernah memblokir simpan/terima.
const INSPECTION_KEY = 'inv360.inspeksi.v1';
type InspectionEntry = { checked: string[]; line: string; profileId?: number | null; items?: Array<{ id: string; text: string }> };

function readInspection(): Record<string, InspectionEntry> {
	try {
		return JSON.parse(sessionStorage.getItem(INSPECTION_KEY) || '{}') || {};
	} catch {
		return {};
	}
}

function writeInspection(all: Record<string, InspectionEntry>): void {
	try {
		sessionStorage.setItem(INSPECTION_KEY, JSON.stringify(all));
	} catch (e) {
		console.warn('[inventoryCardApi] status checklist inspeksi tidak tersimpan (diabaikan):', e);
	}
}

/** Apakah checklist ditampilkan? Dikontrol superadmin (setelan checklist_terima_aktif). */
export async function isInspectionEnabled(): Promise<boolean> {
	const s = await loadInventorySettings();
	return s['inventory.knowledge.checklist_terima_aktif'] !== false;
}

export function getInspectionChecked(itemId: number | string): string[] {
	return readInspection()[String(itemId)]?.checked ?? [];
}

/** Simpan status centang barang + ringkasan catatannya. `profile` dipakai menyusun baris catatan. */
export function saveInspection(itemId: number | string, name: string, profile: any, checked: string[]): void {
	const all = readInspection();
	const line = formatInspectionNote(name, buildInspectionItems(profile), new Set(checked));
	if (!checked.length) delete all[String(itemId)];
	else all[String(itemId)] = { checked, line, profileId: profile?.id ?? null, items: buildInspectionItems(profile).map((i: { id: string; text: string }) => ({ id: i.id, text: i.text })) };
	writeInspection(all);
}

/** Baris ringkasan inspeksi untuk catatan dokumen penerimaan ('' bila belum ada yang dicentang). */
export function getInspectionLine(itemId: number | string | null | undefined): string {
	return itemId == null ? '' : readInspection()[String(itemId)]?.line ?? '';
}

/** Hapus status centang setelah penerimaan tersimpan. */
export function clearInspection(itemId: number | string | null | undefined): void {
	if (itemId == null) return;
	const all = readInspection();
	if (!(String(itemId) in all)) return;
	delete all[String(itemId)];
	writeInspection(all);
}

/**
 * Penerimaan MANUAL (tanpa PO/SJ): kirim hasil checklist barang ini ke server SETELAH transaksi stok tersimpan. Server merekamnya
 * dengan rujukan bertoken [stx:<id>] dan me-relay gate G_INV_SPEC_RECEIVE (shadow). Best-effort: tidak pernah melempar —
 * penerimaan fisik tidak boleh ikut gagal. Mati bila setelan checklist_terima_simpan belum menyala.
 */
export async function reportManualReceiptInspection(itemId: number | string | null | undefined, stockTransactionId: number | string | null | undefined, referenceNo: string): Promise<void> {
	if (itemId == null || stockTransactionId == null) return;
	try {
		const s = await loadInventorySettings();
		if (s['inventory.knowledge.checklist_terima_simpan'] !== true) return;
		const payload = buildInspectionPayload([itemId]);
		const token = await getIdToken();
		const res = await fetch('/api/inventory-360/inspeksi-terima', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ collection: 'items/stock_transactions', recordId: String(stockTransactionId), label: referenceNo, ...payload })
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
	} catch (e) {
		console.error('[inventoryCardApi] rekaman inspeksi penerimaan manual tidak terkirim (penerimaan tetap sukses):', e);
	}
}

export type PrefetchResult = {
	/** barang unik yang diminta */
	requested: number;
	/** dipangkas karena melebihi batas penyimpanan HP */
	trimmed: number;
	/** dilewati: salinan offline masih segar */
	skippedFresh: number;
	/** diunduh dari server */
	fetched: number;
	/** benar-benar tersimpan di HP (punya profil) */
	saved: number;
	/** diunduh tapi belum punya profil -> tak ada panduan untuk disimpan */
	noProfile: number;
};

/**
 * "Unduh panduan proyek": pra-muat Kartu 360° banyak barang sekaligus ke Pocket Guide, SEBELUM berangkat ke site.
 * `itemIds` berurutan prioritas. Hemat request: dipangkas ke batas HP, yang masih segar dilewati, diambil per batch 100.
 * Melempar Error bila sedang offline / fitur dimatikan / pengambilan gagal (data yang sudah tersimpan tetap ada).
 */
export async function prefetchKnowledgeCards(
	itemIds: Array<number | string | null | undefined>,
	onProgress?: (done: number, total: number) => void
): Promise<PrefetchResult> {
	if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Tidak ada sinyal. Unduh panduan saat HP terhubung internet.');
	const s = await loadInventorySettings();
	pocketCfg = {
		enabled: s['inventory.knowledge.pocket_offline_aktif'] !== false,
		maxItems: Number(s['inventory.knowledge.pocket_maks_item']) || POCKET_DEFAULT_MAX_ITEMS,
		maxAgeDays: Number(s['inventory.knowledge.pocket_umur_maks_hari'] ?? POCKET_DEFAULT_MAX_AGE_DAYS)
	};
	if (!pocketCfg.enabled) throw new Error('Panduan offline dimatikan oleh admin (setelan pocket_offline_aktif).');

	const pocket = createPocketGuide(browserPocketStorage(), pocketCfg);
	const plan = planPrefetch(itemIds, pocketCfg.maxItems, (id) => pocket.get(id)?.offline?.at ?? null);
	const requested = new Set(itemIds.map(Number).filter((n) => Number.isFinite(n) && n > 0)).size;
	const result: PrefetchResult = { requested, trimmed: plan.trimmed, skippedFresh: plan.skippedFresh, fetched: 0, saved: 0, noProfile: 0 };
	onProgress?.(0, plan.toFetch.length);

	for (let i = 0; i < plan.toFetch.length; i += BATCH_SIZE) {
		const chunk = plan.toFetch.slice(i, i + BATCH_SIZE);
		const cards = await fetchCardsWith({ fetchJson: secureDirectusJson, loadTemplates: getTemplates }, chunk);
		const list = chunk.map((id) => (cards.get(id) as KnowledgeCardData | undefined) || null);
		for (const [idx, id] of chunk.entries()) cardCache.set(id, { at: Date.now(), card: list[idx] });
		const withProfile = list.filter((c) => c?.profile);
		result.fetched += chunk.length;
		result.noProfile += chunk.length - withProfile.length;
		result.saved += pocket.saveMany(withProfile);
		onProgress?.(Math.min(i + chunk.length, plan.toFetch.length), plan.toFetch.length);
	}
	return result;
}

/**
 * Muatan checklist untuk dikirim bersama konfirmasi penerimaan (server merekamnya dengan rujukan dokumen).
 * `identitasBarangIds` = semua barang master yang diterima (juga yang tidak dicentang) agar gate bisa menilai kelengkapannya.
 */
export function buildInspectionPayload(itemIds: Array<number | string | null | undefined>): {
	inspeksi: Array<{ itemId: number; profileId: number | null; items: Array<{ id: string; text: string }>; checked: string[] }>;
	identitasBarangIds: number[];
} {
	const ids = [...new Set(itemIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
	const all = readInspection();
	const inspeksi = ids
		.map((id) => ({ id, e: all[String(id)] }))
		.filter(({ e }) => e?.checked?.length && e.items?.length)
		.map(({ id, e }) => ({ itemId: id, profileId: e!.profileId ?? null, items: e!.items!, checked: e!.checked }));
	return { inspeksi, identitasBarangIds: ids };
}
