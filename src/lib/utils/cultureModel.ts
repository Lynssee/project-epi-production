// src/lib/utils/cultureModel.ts
// Salinan setia (subset sisi-baca) dari erp-epi/src/lib/utils/cultureModel.js — logika murni Konten Propaganda Budaya.
// Ubah KEDUANYA bersamaan. Pemilihan konten harian DETERMINISTIK per tanggal: banner ESS, TBM, Kiosk, dan WA pagi
// menampilkan konten yang sama pada hari yang sama. Semua fungsi null-safe.

export const ACK_STATUS = { DIBACA: 'dibaca', PAHAM: 'paham_komitmen', KUIS_BENAR: 'kuis_benar', KUIS_SALAH: 'kuis_salah' } as const;
export const ACK_DONE = new Set<string>([ACK_STATUS.PAHAM, ACK_STATUS.KUIS_BENAR]);

export const PROPAGANDA_FIELDS = [
	'id', 'judul', 'isi_pesan', 'tipe', 'core_value_id', 'target_audiens', 'target_divisi',
	'pertanyaan_kuis', 'opsi_kuis', 'jawaban_benar_idx', 'tanggal_mulai', 'tanggal_selesai', 'prioritas', 'aktif'
];

/** Kolom Fase 6 — dibaca TERPISAH (fail-soft). Lihat erp-epi/scripts/budaya-schema-fase6.mjs. */
export const PROPAGANDA_FIELDS_FASE6 = [
	'trigger_moments', 'display_mode', 'timing_absen', 'scheduled_times', 'active_days', 'popup_behavior',
	'sop_document_id', 'target_roles', 'target_pola_kerja', 'penjelasan_kuis', 'kuis_sumber', 'kuis_reviewed', 'microquiz_aktif', 'urgent_sampai'
];
export const ACK_FIELDS_FASE6 = ['momen', 'percobaan'];

export type Audiens = 'semua' | 'lapangan' | 'admin' | 'kiosk';

const lc = (s: unknown) => String(s ?? '').trim().toLowerCase();

export function normalizeList(value: unknown): string[] {
	let v: any = value;
	if (typeof v === 'string') {
		const t = v.trim();
		if (t.startsWith('[')) {
			try {
				v = JSON.parse(t);
			} catch {
				v = [t];
			}
		} else v = t ? t.split(/\r?\n|,/) : [];
	}
	return Array.isArray(v) ? v.map((s) => String(s ?? '').trim()).filter(Boolean) : [];
}

export function hasKuis(item: any): boolean {
	const opsi = normalizeList(item?.opsi_kuis);
	const idx = Number(item?.jawaban_benar_idx);
	return !!String(item?.pertanyaan_kuis ?? '').trim() && opsi.length >= 2 && Number.isInteger(idx) && idx >= 0 && idx < opsi.length;
}

export function isActiveOn(item: any, ymd: string): boolean {
	if (!item || item.aktif === false) return false;
	const mulai = item.tanggal_mulai ? String(item.tanggal_mulai).slice(0, 10) : null;
	const selesai = item.tanggal_selesai ? String(item.tanggal_selesai).slice(0, 10) : null;
	if (mulai && ymd < mulai) return false;
	if (selesai && ymd > selesai) return false;
	return true;
}

export function matchesAudience(item: any, audience: string, divisi?: string | null): boolean {
	const target = lc(item?.target_audiens) || 'semua';
	if (target !== 'semua' && target !== lc(audience)) return false;
	const divs = normalizeList(item?.target_divisi).map(lc);
	if (!divs.length) return true;
	return divs.includes(lc(divisi));
}

export function dayNumber(ymd: string): number {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? ''));
	if (!m) return 0;
	return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
}

export function pickToday(items: any[] | null | undefined, ymd: string, opts: { audience?: string; divisi?: string | null } = {}): any | null {
	const { audience = 'semua', divisi = '' } = opts;
	const eligible = (Array.isArray(items) ? items : []).filter(
		(i) => i && isActiveOn(i, ymd) && matchesAudience(i, audience, divisi) && String(i.isi_pesan ?? '').trim()
	);
	if (!eligible.length) return null;
	const top = Math.max(...eligible.map((i) => Number(i.prioritas ?? 0) || 0));
	const group = eligible
		.filter((i) => (Number(i.prioritas ?? 0) || 0) === top)
		.sort((a, b) => Number(a.id ?? 0) - Number(b.id ?? 0));
	return group[dayNumber(ymd) % group.length];
}

export interface ClientItem {
	id: number;
	judul: string;
	isi_pesan: string;
	tipe: string;
	core_value_id: number | null;
	poster_id: string | null;
	pertanyaan_kuis: string | null;
	opsi_kuis: string[];
}

/** Bentuk aman untuk klien: TANPA kunci jawaban. */
export function toClientItem(item: any): ClientItem | null {
	if (!item) return null;
	const kuis = hasKuis(item);
	return {
		id: item.id,
		judul: String(item.judul ?? ''),
		isi_pesan: String(item.isi_pesan ?? ''),
		tipe: String(item.tipe ?? ''),
		core_value_id: item.core_value_id ?? null,
		poster_id: item.poster_id ?? null,
		pertanyaan_kuis: kuis ? String(item.pertanyaan_kuis).trim() : null,
		opsi_kuis: kuis ? normalizeList(item.opsi_kuis) : []
	};
}

export function gradeAck(item: any, aksi: string, jawabanIdx?: unknown): string | null {
	if (!item) return null;
	if (aksi === 'kuis') {
		if (!hasKuis(item)) return null;
		const idx = Number(jawabanIdx);
		if (!Number.isInteger(idx)) return null;
		return idx === Number(item.jawaban_benar_idx) ? ACK_STATUS.KUIS_BENAR : ACK_STATUS.KUIS_SALAH;
	}
	if (aksi === 'komitmen') return hasKuis(item) ? null : ACK_STATUS.PAHAM;
	return null;
}

export function shouldWriteAck(existingStatus: string | null | undefined, newStatus: string | null): boolean {
	if (!newStatus) return false;
	if (!existingStatus) return true;
	if (ACK_DONE.has(existingStatus)) return false;
	return existingStatus !== newStatus;
}

/** Salinan setia erp-epi/src/lib/utils/cultureGates.js#evalTbmBrief — gate G_TBM_CULTURE_BRIEF (TBM memuat topik/pesan budaya). */
export function evalTbmBrief(input: { hasItem: boolean; topic?: unknown; dibacakan?: unknown }): { status: 'passed' | 'failed' | 'not_applicable'; message: string } {
	if (!input.hasItem) return { status: 'not_applicable', message: 'Tidak ada pesan budaya yang tayang hari ini.' };
	const d = input.dibacakan;
	if (d === true || d === 1 || d === '1' || d === 'true' || String(input.topic ?? '').trim()) return { status: 'passed', message: 'TBM memuat topik/pesan budaya.' };
	return {
		status: 'failed',
		message: 'TBM pagi belum memuat topik budaya/keselamatan. Isi topik TBM (mis. pakai tombol "Gunakan di Topik TBM") atau tandai pesan budaya sudah dibacakan.'
	};
}

export function formatQuoteLine(item: any): string {
	const pesan = String(item?.isi_pesan ?? '').replace(/\s+/g, ' ').trim();
	return pesan ? `📢 Budaya Hari Ini: ${pesan}` : '';
}

// ── Setelan app_settings modul `culture` (salinan setia erp-epi/src/lib/utils/cultureModel.js) ──────────────
export const CULTURE_MODULE = 'culture';
/** Bawaan Golden Rules (satu butir per baris) — salinan setia erp-epi; dapat diubah di Pengaturan. */
export const DEFAULT_GOLDEN_RULES = [
	'Pakai APD lengkap sebelum mulai bekerja.',
	'Laporkan kondisi tidak aman dan berhenti bekerja bila membahayakan.',
	'Jaga mutu pekerjaan dan nama baik EPI di depan klien.'
].join('\n');
export const HARI_OPTIONS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];

export interface CultureSettingDef {
	key: string;
	type: 'boolean' | 'number' | 'select' | 'text';
	def: boolean | number | string;
	min?: number;
	max?: number;
	options?: string[];
}
export type CultureSettingValue = boolean | number | string;

export const CULTURE_SETTING_DEFS: CultureSettingDef[] = [
	{ key: 'culture.banner_enabled', type: 'boolean', def: true },
	{ key: 'culture.tbm_injection_enabled', type: 'boolean', def: true },
	{ key: 'culture.kiosk_banner_enabled', type: 'boolean', def: true },
	{ key: 'culture.wa_briefing_quote_enabled', type: 'boolean', def: true },
	{ key: 'culture.mood_checkin_enabled', type: 'boolean', def: true },
	{ key: 'culture.mood_checkin_day', type: 'select', options: HARI_OPTIONS, def: 'Senin' },
	{ key: 'culture.pulse_enps_day_of_month', type: 'number', min: 1, max: 28, def: 1 },
	{ key: 'culture.motivation_alert_enabled', type: 'boolean', def: true },
	{ key: 'culture.motivation_alert_threshold', type: 'number', min: 1, max: 5, def: 3.0 },
	{ key: 'culture.motivation_min_group', type: 'number', min: 2, max: 10, def: 3 },
	{ key: 'culture.wall_of_belonging_days', type: 'number', min: 1, max: 30, def: 7 },
	{ key: 'culture.golden_rules_enabled', type: 'boolean', def: true },
	{ key: 'culture.golden_rules_wajib', type: 'boolean', def: false },
	{ key: 'culture.golden_rules_teks', type: 'text', def: DEFAULT_GOLDEN_RULES },
	{ key: 'culture.spotlight_scan_days', type: 'number', min: 1, max: 60, def: 14 },
	{ key: 'culture.spotlight_days', type: 'number', min: 1, max: 30, def: 7 },
	{ key: 'culture.kiosk_standby_enabled', type: 'boolean', def: true },
	{ key: 'culture.kiosk_standby_idle_seconds', type: 'number', min: 30, max: 900, def: 120 },
	// Popup berbasis momen + microquiz (Fase 6) — selaras dengan erp-epi/cultureModel.js
	{ key: 'culture.popup_enabled', type: 'boolean', def: false },
	{ key: 'culture.popup_momen_clock_in', type: 'boolean', def: true },
	{ key: 'culture.popup_momen_break_out', type: 'boolean', def: false },
	{ key: 'culture.popup_momen_break_in', type: 'boolean', def: true },
	{ key: 'culture.popup_momen_clock_out', type: 'boolean', def: true },
	{ key: 'culture.popup_momen_app_open', type: 'boolean', def: false },
	{ key: 'culture.popup_momen_scheduled_time', type: 'boolean', def: true },
	{ key: 'culture.popup_timing_default', type: 'select', options: ['after', 'before'], def: 'after' },
	{ key: 'culture.popup_rotasi', type: 'select', options: ['prioritas_lalu_rotasi', 'acak_harian', 'berurutan'], def: 'prioritas_lalu_rotasi' },
	{ key: 'culture.popup_min_gap_menit', type: 'number', min: 0, max: 240, def: 30 },
	{ key: 'culture.popup_max_per_hari', type: 'number', min: 1, max: 10, def: 3 },
	{ key: 'culture.popup_cache_ttl_detik', type: 'number', min: 30, max: 900, def: 120 },
	{ key: 'culture.microquiz_enabled', type: 'boolean', def: false },
	{ key: 'culture.microquiz_tipe_aktif', type: 'text', def: 'reminder_sop,tips_kerja' },
	{ key: 'culture.microquiz_max_per_hari', type: 'number', min: 1, max: 5, def: 1 },
	{ key: 'culture.microquiz_retry', type: 'number', min: 0, max: 2, def: 1 },
	{ key: 'culture.microquiz_ulang_salah_hari', type: 'number', min: 1, max: 30, def: 2 },
	{ key: 'culture.microquiz_ulang_benar_hari', type: 'number', min: 1, max: 180, def: 30 },
	{ key: 'culture.microquiz_tampilkan_penjelasan', type: 'boolean', def: true }
];
export const CULTURE_DEFAULTS: Record<string, CultureSettingValue> = Object.fromEntries(CULTURE_SETTING_DEFS.map((d) => [d.key, d.def]));

const parseBool = (v: unknown, def: boolean): boolean => {
	if (v === true || v === 'true' || v === 1 || v === '1') return true;
	if (v === false || v === 'false' || v === 0 || v === '0') return false;
	return def;
};

export function parseCultureValue(def: CultureSettingDef | undefined, raw: unknown): CultureSettingValue | undefined {
	if (!def) return undefined;
	if (def.type === 'boolean') return parseBool(raw, def.def as boolean);
	if (def.type === 'number') {
		const n = Number(raw);
		if (raw == null || raw === '' || !Number.isFinite(n)) return def.def;
		return Math.min(def.max ?? n, Math.max(def.min ?? n, n));
	}
	if (def.type === 'text') {
		const t = String(raw ?? '').replace(/\r\n/g, '\n').trim();
		return t ? t.slice(0, 1000) : def.def;
	}
	const hit = (def.options || []).find((o) => o.toLowerCase() === String(raw ?? '').trim().toLowerCase());
	return hit ?? def.def;
}

export function resolveCultureSettings(rows: any[] | null | undefined): Record<string, CultureSettingValue> {
	const out: Record<string, CultureSettingValue> = { ...CULTURE_DEFAULTS };
	const byKey = new Map(CULTURE_SETTING_DEFS.map((d) => [d.key, d]));
	for (const r of Array.isArray(rows) ? rows : []) {
		const def = byKey.get(r?.setting_key);
		if (def) out[def.key] = parseCultureValue(def, r.setting_value ?? r.value) as CultureSettingValue;
	}
	return out;
}
