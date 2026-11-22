// src/lib/utils/culturePopupClient.ts
// Logika klien (MURNI, tanpa DOM) untuk CulturePopupHost lapangan. Salinan setia dari erp-epi/src/lib/utils/culturePopupClient.js —
// ubah KEDUANYA bersamaan. Status harian popup di storage lokal + keputusan "popup apa yang tampil sekarang".
// Server stateless; batas tayang/jeda dijaga di sini (per perangkat, per hari). Null-safe, tidak pernah melempar.
import { pickByMoment, canShowPopup, popupMomentEnabled, dueScheduledSlot, isUrgent } from './cultureMoment';

export const CULTURE_MOMENT_EVENT = 'culture:moment';
const STATE_PREFIX = 'culturePopup:state:';
const PAYLOAD_PREFIX = 'culturePopup:payload:';

export type Momen = 'clock_in' | 'break_out' | 'break_in' | 'clock_out' | 'app_open' | 'scheduled_time';
type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void } | null | undefined;

export interface DayState {
	shownToday: number;
	lastShownAtMs: number;
	perItem: Record<string, number>;
	slots: Record<string, boolean>;
	answered: Record<string, boolean>;
}

/** Pemicu momen dari halaman mana pun: triggerCultureMoment('clock_in') → CulturePopupHost yang menampilkan (bila ada). */
export function triggerCultureMoment(momen: Momen, opts: { timing?: 'before' | 'after' } = {}): void {
	try {
		if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CULTURE_MOMENT_EVENT, { detail: { momen, timing: opts.timing ?? 'after' } }));
	} catch (e) {
		console.warn('[culturePopup] gagal memicu momen:', (e as Error)?.message);
	}
}

function safe<T>(fn: () => T, def: T): T {
	try {
		return fn();
	} catch {
		return def;
	}
}

export function emptyDayState(): DayState {
	return { shownToday: 0, lastShownAtMs: 0, perItem: {}, slots: {}, answered: {} };
}

export function loadDayState(storage: StorageLike, userKey: string, ymd: string): DayState {
	const parsed = safe(() => JSON.parse(storage?.getItem(`${STATE_PREFIX}${userKey}`) as string), null as any);
	return parsed && parsed.ymd === ymd && parsed.state ? { ...emptyDayState(), ...parsed.state } : emptyDayState();
}
export function saveDayState(storage: StorageLike, userKey: string, ymd: string, state: unknown): void {
	safe(() => storage?.setItem(`${STATE_PREFIX}${userKey}`, JSON.stringify({ ymd, state })), undefined);
}
export function loadCachedPayload(storage: StorageLike, userKey: string, ymd: string): any | null {
	const p = safe(() => JSON.parse(storage?.getItem(`${PAYLOAD_PREFIX}${userKey}`) as string), null as any);
	return p && p.ymd === ymd && p.payload ? p.payload : null;
}
export function saveCachedPayload(storage: StorageLike, userKey: string, ymd: string, payload: unknown): void {
	safe(() => storage?.setItem(`${PAYLOAD_PREFIX}${userKey}`, JSON.stringify({ ymd, payload })), undefined);
}

export function recordShown(state: Partial<DayState> | null | undefined, itemId: number | string, nowMs: number, slot: string | null = null): DayState {
	const s = { ...emptyDayState(), ...(state || {}) };
	const per = { ...(s.perItem || {}) };
	per[itemId] = (Number(per[itemId]) || 0) + 1;
	const slots = { ...(s.slots || {}) };
	if (slot) slots[`${itemId}@${slot}`] = true;
	return { ...s, shownToday: (Number(s.shownToday) || 0) + 1, lastShownAtMs: nowMs, perItem: per, slots };
}
export function recordAnswered(state: Partial<DayState> | null | undefined, itemId: number | string): DayState {
	const s = { ...emptyDayState(), ...(state || {}) };
	return { ...s, answered: { ...(s.answered || {}), [itemId]: true } };
}

export interface PopupDecision {
	item: any;
	microquiz: { id: number; pertanyaan: string; opsi: string[]; sop_document_id?: number | null } | null;
	slot: string | null;
}

/**
 * Putuskan popup yang tampil untuk momen ini. Konten darurat (urgent) melewati jeda & batas harian.
 * `online=false` → microquiz dibuang (tanpa sinyal tidak bisa dinilai server; popup tetap tampil sebagai kartu baca).
 */
export function decidePopup(
	payload: any,
	state: Partial<DayState> | null | undefined,
	o: { momen: Momen; timing?: 'before' | 'after'; hhmm?: string; nowMs?: number; ymd?: string; online?: boolean }
): PopupDecision | null {
	if (!payload?.enabled || !Array.isArray(payload.items) || !payload.items.length) return null;
	const settings = payload.settings || {};
	const { momen, timing = 'after', hhmm = '', nowMs = Date.now(), ymd = '', online = true } = o;
	if (!popupMomentEnabled(settings, momen)) return null;
	const st = { ...emptyDayState(), ...(state || {}) };
	const ctx = { ymd: ymd || payload.ymd, momen, audience: 'semua', hhmm, timing, nowMs, settings };
	const pool = payload.items.filter((i: any) => {
		if (momen !== 'scheduled_time') return true;
		const slot = dueScheduledSlot(i.scheduled_times, hhmm);
		return !!slot && !st.slots[`${i.id}@${slot}`];
	});
	const [item] = pickByMoment(pool, ctx, { limit: 1, tampilHariIni: st.perItem });
	if (!item) return null;
	if (!canShowPopup(st, nowMs, settings, { urgent: isUrgent(item, nowMs) })) return null;
	const slot = momen === 'scheduled_time' ? dueScheduledSlot(item.scheduled_times, hhmm) : null;
	const mq = online && item.microquiz && !st.answered[item.id] ? item.microquiz : null;
	return { item, microquiz: mq, slot };
}
