// src/lib/utils/cultureMoment.ts
// Salinan setia (sisi-baca) dari erp-epi/src/lib/utils/cultureMoment.js — Popup Berbasis Momen + Microquiz. Ubah KEDUANYA bersamaan.
// Validasi editor (validateMicroquiz) hanya ada di erp-epi (admin). Popup TIDAK PERNAH memblokir absen; deterministik per tanggal.
import { ACK_STATUS, CULTURE_DEFAULTS, dayNumber, hasKuis, isActiveOn, matchesAudience, normalizeList } from './cultureModel';

const MOMEN_VALUES = ['clock_in', 'break_out', 'break_in', 'clock_out', 'app_open', 'scheduled_time'];
const MOMEN_ABSEN = ['clock_in', 'break_out', 'break_in', 'clock_out'];
const DISPLAY_MODES = ['banner', 'popup', 'both'];
const TIMING_ABSEN = ['after', 'before'];
const TEMA_VALUES = ['indigo', 'emerald', 'amber', 'rose', 'sky'];
const MICROQUIZ_TIPE_DEFAULT = ['reminder_sop', 'tips_kerja'];

type Settings = Record<string, boolean | number | string> | null | undefined;
export interface MomentCtx {
	ymd?: string; momen?: string; audience?: string; divisi?: string | null; role?: string; polaKerja?: string;
	hhmm?: string; timing?: 'before' | 'after'; nowMs?: number; settings?: Settings;
}
export interface AckHistoryRow { propaganda_id: number | string; status_aksi?: string | null; tanggal?: string | null }

const lc = (s: unknown) => String(s ?? '').trim().toLowerCase();
const num = (v: unknown, def: number) => (Number.isFinite(Number(v)) ? Number(v) : def);
const normalizeOpsi = (v: unknown) => normalizeList(v);

export function cs(settings: Settings, key: string): any {
	const k = `culture.${key}`;
	const v = settings?.[k];
	return v === undefined || v === null ? CULTURE_DEFAULTS[k] : v;
}

export function normalizeMomen(value: unknown): string[] {
	return [...new Set(normalizeList(value).map(lc).filter((m) => MOMEN_VALUES.includes(m)))];
}
export function normalizeDays(value: unknown): number[] {
	return [...new Set(normalizeList(value).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))].sort((a, b) => a - b);
}
export function normalizeTimes(value: unknown): string[] {
	const ok = normalizeList(value).map((t) => {
		const m = /^(\d{1,2}):(\d{2})$/.exec(t);
		if (!m) return null;
		const h = Number(m[1]);
		const mi = Number(m[2]);
		return h <= 23 && mi <= 59 ? `${String(h).padStart(2, '0')}:${m[2]}` : null;
	}).filter((x): x is string => !!x);
	return [...new Set(ok)].sort();
}
/** Hari ISO (1=Senin … 7=Minggu) dari YYYY-MM-DD. */
export function isoDow(ymd: string): number {
	return ((dayNumber(ymd) + 3) % 7) + 1;
}
const toMin = (hhmm: unknown): number | null => {
	const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? ''));
	return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export function dueScheduledSlot(times: unknown, hhmm: unknown, windowMin = 30): string | null {
	const now = toMin(hhmm);
	if (now == null) return null;
	let best: string | null = null;
	for (const t of normalizeTimes(times)) {
		const m = toMin(t);
		if (m != null && m <= now && now - m <= windowMin && (best == null || m > (toMin(best) as number))) best = t;
	}
	return best;
}

export function popupBehavior(raw: unknown) {
	let b: any = raw;
	if (typeof b === 'string') {
		try { b = JSON.parse(b); } catch { b = null; }
	}
	b = b && typeof b === 'object' ? b : {};
	const tone = lc(b.theme_tone);
	return {
		dismissible: b.dismissible !== false,
		require_ack: b.require_ack === true,
		auto_close_sec: Math.min(60, Math.max(0, Math.trunc(num(b.auto_close_sec, 0)))),
		max_show_per_day: Math.min(10, Math.max(1, Math.trunc(num(b.max_show_per_day, 1)))),
		cta_label: String(b.cta_label ?? '').trim().slice(0, 30) || 'Paham',
		theme_tone: TEMA_VALUES.includes(tone) ? tone : 'indigo'
	};
}

function matchesTargets(item: any, { role = '', polaKerja = '' }: { role?: string; polaKerja?: string } = {}): boolean {
	const roles = normalizeList(item?.target_roles).map(lc);
	if (roles.length && !roles.includes(lc(role))) return false;
	const pola = normalizeList(item?.target_pola_kerja).map(lc);
	if (pola.length && !pola.includes(lc(polaKerja))) return false;
	return true;
}

export function isUrgent(item: any, nowMs?: number): boolean {
	const t = Date.parse(String(item?.urgent_sampai ?? ''));
	return Number.isFinite(t) && t > num(nowMs, Date.now());
}

export function popupMomentEnabled(settings: Settings, momen: string): boolean {
	if (cs(settings, 'popup_enabled') !== true) return false;
	return cs(settings, `popup_momen_${momen}`) !== false;
}

export function eligibleForMoment(item: any, ctx: MomentCtx = {}): boolean {
	if (!item || !String(item.isi_pesan ?? '').trim()) return false;
	const { ymd = '', momen = '', settings } = ctx;
	if (!MOMEN_VALUES.includes(momen)) return false;
	if (!isActiveOn(item, ymd) || !matchesAudience(item, ctx.audience ?? 'semua', ctx.divisi) || !matchesTargets(item, ctx)) return false;
	const mode = lc(item.display_mode) || 'banner';
	if (!DISPLAY_MODES.includes(mode) || mode === 'banner') return false;
	if (!normalizeMomen(item.trigger_moments).includes(momen)) return false;
	const days = normalizeDays(item.active_days);
	if (days.length && !days.includes(isoDow(ymd))) return false;
	if (momen === 'scheduled_time' && !dueScheduledSlot(item.scheduled_times, ctx.hhmm)) return false;
	if (MOMEN_ABSEN.includes(momen) && ctx.timing) {
		const t = lc(item.timing_absen);
		const timing = TIMING_ABSEN.includes(t) ? t : cs(settings, 'popup_timing_default');
		if (timing !== ctx.timing) return false;
	}
	return true;
}

function hashStr(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

export function pickByMoment(items: any[] | null | undefined, ctx: MomentCtx = {}, { limit = 1, tampilHariIni = {} }: { limit?: number; tampilHariIni?: Record<string | number, number> } = {}): any[] {
	const { ymd = '', nowMs, settings } = ctx;
	const rotasi = cs(settings, 'popup_rotasi');
	const eligible = (Array.isArray(items) ? items : []).filter((i) => {
		if (!eligibleForMoment(i, ctx)) return false;
		const shown = Number(tampilHariIni?.[i.id] ?? 0) || 0;
		return shown < popupBehavior(i.popup_behavior).max_show_per_day;
	});
	const day = dayNumber(ymd);
	const byPrio = new Map<number, any[]>();
	for (const i of eligible) {
		const p = Number(i.prioritas ?? 0) || 0;
		if (!byPrio.has(p)) byPrio.set(p, []);
		byPrio.get(p)!.push(i);
	}
	const ordered: any[] = [];
	for (const p of [...byPrio.keys()].sort((a, b) => b - a)) {
		const g = byPrio.get(p)!.sort((a, b) => Number(a.id ?? 0) - Number(b.id ?? 0));
		if (rotasi === 'acak_harian') g.sort((a, b) => hashStr(`${day}:${a.id}`) - hashStr(`${day}:${b.id}`));
		else if (rotasi === 'prioritas_lalu_rotasi') {
			const r = day % g.length;
			g.push(...g.splice(0, r));
		}
		ordered.push(...g);
	}
	const urgent = ordered.filter((i) => isUrgent(i, nowMs));
	const rest = ordered.filter((i) => !isUrgent(i, nowMs));
	return [...urgent, ...rest].slice(0, Math.max(1, limit));
}

export function canShowPopup(state: { shownToday?: number; lastShownAtMs?: number } | null | undefined, nowMs: number, settings: Settings, { urgent = false }: { urgent?: boolean } = {}): boolean {
	if (urgent) return true;
	const shown = Number(state?.shownToday ?? 0) || 0;
	if (shown >= cs(settings, 'popup_max_per_hari')) return false;
	const last = Number(state?.lastShownAtMs ?? 0) || 0;
	const gapMs = Number(cs(settings, 'popup_min_gap_menit')) * 60000;
	return !(last && nowMs - last < gapMs);
}

// ── Microquiz (memakai ulang kolom kuis) ─────────────────────────────────────
export function microquizTipeAktif(settings: Settings): string[] {
	const list = normalizeList(cs(settings, 'microquiz_tipe_aktif')).map(lc);
	return list.length ? list : MICROQUIZ_TIPE_DEFAULT;
}
export function isMicroquizEligible(item: any, settings: Settings): boolean {
	if (!item || cs(settings, 'microquiz_enabled') !== true) return false;
	if (!hasKuis(item) || item.microquiz_aktif === false || item.kuis_reviewed === false) return false;
	return microquizTipeAktif(settings).includes(lc(item.tipe));
}

const isKuisStatus = (s: unknown) => s === ACK_STATUS.KUIS_BENAR || s === ACK_STATUS.KUIS_SALAH;

export function pickMicroquiz(candidates: any[] | null | undefined, history: AckHistoryRow[] | null | undefined, ymd: string, settings: Settings): any | null {
	const rows = (Array.isArray(history) ? history : []).filter((r) => r && isKuisStatus(r.status_aksi));
	const today = rows.filter((r) => String(r.tanggal ?? '').slice(0, 10) === ymd).length;
	if (today >= cs(settings, 'microquiz_max_per_hari')) return null;
	const salahDays = cs(settings, 'microquiz_ulang_salah_hari');
	const benarDays = cs(settings, 'microquiz_ulang_benar_hari');
	const ranked: { c: any; rank: number }[] = [];
	for (const c of Array.isArray(candidates) ? candidates : []) {
		if (!isMicroquizEligible(c, settings)) continue;
		const mine = rows.filter((r) => Number(r.propaganda_id) === Number(c.id)).sort((a, b) => String(b.tanggal).localeCompare(String(a.tanggal)));
		const last = mine[0];
		let rank: number;
		if (!last) rank = 0;
		else {
			const age = dayNumber(ymd) - dayNumber(String(last.tanggal).slice(0, 10));
			if (last.status_aksi === ACK_STATUS.KUIS_SALAH) rank = age >= salahDays ? 1 : -1;
			else rank = age >= benarDays ? 2 : -1;
		}
		if (rank >= 0) ranked.push({ c, rank });
	}
	ranked.sort((a, b) => a.rank - b.rank || (Number(b.c.prioritas ?? 0) || 0) - (Number(a.c.prioritas ?? 0) || 0) || Number(a.c.id ?? 0) - Number(b.c.id ?? 0));
	return ranked[0]?.c ?? null;
}

/** Soal untuk klien: TANPA kunci & TANPA penjelasan. */
export function toClientMicroquiz(item: any) {
	if (!item || !hasKuis(item)) return null;
	return { id: item.id, pertanyaan: String(item.pertanyaan_kuis).trim(), opsi: normalizeOpsi(item.opsi_kuis), sop_document_id: item.sop_document_id ?? null };
}

export interface MicroquizGrade {
	valid: boolean; benar?: boolean; boleh_ulang?: boolean; status_aksi?: string | null; percobaan?: number; kunci_idx?: number | null; penjelasan?: string | null;
}
export function gradeMicroquiz(item: any, jawabanIdx: unknown, percobaan: unknown, settings: Settings): MicroquizGrade {
	if (!item || !hasKuis(item)) return { valid: false };
	const idx = Number(jawabanIdx);
	const opsi = normalizeOpsi(item.opsi_kuis);
	if (!Number.isInteger(idx) || idx < 0 || idx >= opsi.length) return { valid: false };
	const maxTry = 1 + Math.max(0, Math.trunc(num(cs(settings, 'microquiz_retry'), 1)));
	const attempt = Math.min(maxTry, Math.max(1, Math.trunc(num(percobaan, 1))));
	const benar = idx === Number(item.jawaban_benar_idx);
	const habis = attempt >= maxTry;
	const penjelasan = cs(settings, 'microquiz_tampilkan_penjelasan') === true ? String(item.penjelasan_kuis ?? '').trim() || null : null;
	if (benar) return { valid: true, benar: true, boleh_ulang: false, status_aksi: ACK_STATUS.KUIS_BENAR, percobaan: attempt, kunci_idx: idx, penjelasan };
	if (!habis) return { valid: true, benar: false, boleh_ulang: true, status_aksi: null, percobaan: attempt, kunci_idx: null, penjelasan: null };
	return { valid: true, benar: false, boleh_ulang: false, status_aksi: ACK_STATUS.KUIS_SALAH, percobaan: attempt, kunci_idx: Number(item.jawaban_benar_idx), penjelasan };
}
