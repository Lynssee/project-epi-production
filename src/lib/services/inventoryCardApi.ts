// src/lib/services/inventoryCardApi.ts
// Inventory 360° Fase 4 — data Kartu Pengetahuan untuk DASHBOARD LAPANGAN.
//
// Hemat API & hemat baterai/kuota (HP di lapangan): kartu banyak di satu layar TIDAK menembak banyak request —
//  - getKnowledgeCard(id) dikumpulkan ~40 ms lalu diambil sekali per batch,
//  - cache 2 menit (template 5 menit),
//  - logika ambil data = inventory360/inventoryKnowledgeCardCore.js (BYTE-IDENTIK dengan erp-epi, dijaga tes kontrak).
// Lapangan hanya MEMBACA profil; mengisi/memverifikasi profil tetap di dashboard admin (Inventory 360°).
// Error TIDAK ditelan: promise ditolak, komponen menampilkan pesan & mencatat ke console.

import { secureDirectusJson } from './secureDirectus';
import { loadInventorySettings } from './inventorySettings';
import { auth } from '$lib/firebase';
import { createTouchTracker } from './inventory360/inventoryKnowledgeTouch.js';
import { fetchCardsWith, fetchTemplatesWith } from './inventory360/inventoryKnowledgeCardCore.js';

export type KnowledgeCardData = {
	itemId: number;
	source: 'item' | 'group' | 'none';
	profile: any | null;
	template: any | null;
	groupId: string | null;
	href: string;
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
		} catch (e) {
			for (const id of chunk) for (const w of batch.get(id) || []) w.reject(e);
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
