// src/lib/utils/paktaPolicy.ts
// Logika MURNI "Pakta Pra-Kegiatan" — tanpa I/O. Menentukan (a) SOP/Alur mana yang berlaku untuk halaman yang sedang dibuka
// dan (b) apakah halaman itu dikunci, dari mode gate G_FLD_SOP_READ_CONFIRMATION (diatur Super Admin di /settings/gates).
//
// Prinsip (rencana_sistem_pakta_sop_gate §2): kunci KONTEKSTUAL tepat sebelum kegiatan, bukan kunci global saat login.
// Halaman darurat/baca (absen, insiden K3, panduan, notifikasi, bantuan) TIDAK PERNAH dikunci.
// Semua aturan rute, pengecualian, dan waktu baca minimum dibaca dari system_settings (namespace `project.pakta.`);
// nilai default di bawah hanya jaring pengaman bila setelan kosong/rusak.
import type { UnconfirmedItem } from './sopReadRequirement';

export type PaktaGateMode = 'shadow' | 'warn' | 'soft' | 'hard';

export interface PaktaRuleMatch {
	/** Kata kunci (huruf kecil) yang dicari di judul / flow_key / kode SOP / kategori */
	keywords?: string[];
	sop_codes?: string[];
	flow_keys?: string[];
	sop_ids?: number[];
	/** Gate yang perubahannya wajib dikonfirmasi pekerja di rute ini (Pakta jenis gate) */
	gate_keys?: string[];
}

export interface PaktaRouteRule {
	/** Awalan rute (batas segmen): '/stock-lapangan/opname' cocok dengan '/stock-lapangan/opname/123' tapi tidak '/stock-lapangan/opname-sesi' */
	path_prefix: string;
	match: PaktaRuleMatch;
	/** Label ramah untuk judul modal, mis. "Stock Opname" */
	label?: string;
}

export interface PaktaConfig {
	/** Saklar utama. Default MATI: tidak ada perubahan perilaku sampai Super Admin menyalakan di setelan. */
	enabled: boolean;
	route_rules: PaktaRouteRule[];
	exclude_prefixes: string[];
	/** Detik minimal sebelum kotak centang aktif (0 = langsung) — mencegah asal klik. */
	min_read_seconds: number;
	/** Wajib scroll sampai bawah ringkasan sebelum kotak centang aktif. */
	require_scroll: boolean;
	/** Perubahan gate (kenaikan keketatan) dalam N hari terakhir yang dianggap "baru" dan wajib dikonfirmasi. */
	gate_change_days: number;
}

/** Kategori kendala yang bisa dipilih pekerja (dipakai server untuk validasi & UI untuk pilihan) — bahasa awam, bukan kode. */
export const PAKTA_KATEGORI_KENDALA = [
	{ value: 'alat_belum_tersedia', label: 'Alat / bahan belum tersedia di lokasi' },
	{ value: 'prosedur_tak_sesuai_lokasi', label: 'Langkah prosedur tidak sesuai kondisi lokasi' },
	{ value: 'butuh_pelatihan', label: 'Saya belum dilatih / butuh penjelasan' },
	{ value: 'lainnya', label: 'Kendala lain' }
] as const;

export const PAKTA_SETTINGS_NAMESPACE = 'project.pakta.';

/** Selalu dikecualikan, TIDAK bisa dilepas lewat setelan (keselamatan & akses dasar): absen, insiden/darurat K3, login. */
export const MANDATORY_EXCLUDE_PREFIXES = ['/absen', '/hse/insiden', '/hse/darurat', '/login'];

export const DEFAULT_EXCLUDE_PREFIXES = ['/absen', '/hse/insiden', '/hse/darurat', '/notifikasi', '/panduan', '/bantuan', '/support', '/profil', '/login'];

/** Bawaan: semua rute Stock Opname lapangan. Disetel ulang tanpa deploy lewat `project.pakta.route_rules`. */
export const DEFAULT_ROUTE_RULES: PaktaRouteRule[] = [
	{ path_prefix: '/stock-lapangan/opname', label: 'Stock Opname', match: { keywords: ['opname'] } },
	{ path_prefix: '/stock-lapangan/opname-sesi', label: 'Stock Opname', match: { keywords: ['opname'] } },
	{ path_prefix: '/inventory-proyek/opname', label: 'Stock Opname', match: { keywords: ['opname'] } },
	{ path_prefix: '/kiosk/gudang/opname', label: 'Stock Opname', match: { keywords: ['opname'] } }
];

export const DEFAULT_PAKTA_CONFIG: PaktaConfig = {
	enabled: false,
	route_rules: DEFAULT_ROUTE_RULES,
	exclude_prefixes: DEFAULT_EXCLUDE_PREFIXES,
	min_read_seconds: 5,
	require_scroll: false,
	gate_change_days: 30
};

const normPath = (p: unknown): string => {
	const s = String(p ?? '').trim().split(/[?#]/)[0] || '/';
	const withSlash = s.startsWith('/') ? s : `/${s}`;
	return withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : withSlash;
};

const strList = (v: unknown): string[] =>
	Array.isArray(v) ? v.map((x) => String(x ?? '').trim().toLowerCase()).filter(Boolean) : [];

function parseRule(raw: unknown): PaktaRouteRule | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, any>;
	const path = String(r.path_prefix ?? '').trim();
	if (!path.startsWith('/')) return null;
	const m = (r.match && typeof r.match === 'object' ? r.match : {}) as Record<string, unknown>;
	const match: PaktaRuleMatch = {
		keywords: strList(m.keywords),
		sop_codes: strList(m.sop_codes),
		flow_keys: Array.isArray(m.flow_keys) ? m.flow_keys.map((x) => String(x ?? '').trim()).filter(Boolean) : [],
		sop_ids: Array.isArray(m.sop_ids) ? m.sop_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [],
		gate_keys: Array.isArray(m.gate_keys) ? [...new Set(m.gate_keys.map((x) => String(x ?? '').trim().toUpperCase()).filter((x) => /^G_[A-Z0-9_]{1,80}$/.test(x)))] : []
	};
	const kosong = !match.keywords!.length && !match.sop_codes!.length && !match.flow_keys!.length && !match.sop_ids!.length && !match.gate_keys!.length;
	if (kosong) return null; // aturan tanpa kriteria akan mengunci halaman oleh SOP apa pun → ditolak
	return { path_prefix: normPath(path), match, label: typeof r.label === 'string' && r.label.trim() ? r.label.trim() : undefined };
}

/** Baca setelan namespace `project.pakta.` (hasil readSettingsNamespace) → konfigurasi bersih; nilai rusak jatuh ke default. */
export function parsePaktaConfig(cfg: Record<string, unknown> | null | undefined): PaktaConfig {
	const c = cfg || {};
	const ns = PAKTA_SETTINGS_NAMESPACE;
	const rulesRaw = c[`${ns}route_rules`];
	let rules = DEFAULT_ROUTE_RULES;
	if (Array.isArray(rulesRaw)) {
		const parsed = rulesRaw.map(parseRule).filter((r): r is PaktaRouteRule => r !== null);
		rules = parsed; // daftar kosong yang disengaja = tidak ada rute dikunci
	}
	const exRaw = c[`${ns}exclude_prefixes`];
	const exclude = Array.isArray(exRaw)
		? exRaw.map((x) => normPath(x)).filter((x) => x !== '/')
		: DEFAULT_EXCLUDE_PREFIXES;
	const min = Number(c[`${ns}min_read_seconds`]);
	const gcd = Number(c[`${ns}gate_change_days`]);
	return {
		enabled: c[`${ns}enabled`] === true,
		route_rules: rules,
		exclude_prefixes: exclude,
		min_read_seconds: Number.isFinite(min) && min >= 0 ? Math.min(Math.floor(min), 120) : DEFAULT_PAKTA_CONFIG.min_read_seconds,
		require_scroll: c[`${ns}require_scroll`] === true,
		gate_change_days: Number.isFinite(gcd) && gcd >= 1 ? Math.min(Math.floor(gcd), 180) : DEFAULT_PAKTA_CONFIG.gate_change_days
	};
}

const underPrefix = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + '/');

/** Rute dikecualikan (darurat/baca) — TIDAK PERNAH dikunci, apa pun aturan yang ada. */
export function isExcludedPath(path: string, cfg: PaktaConfig): boolean {
	const p = normPath(path);
	return [...MANDATORY_EXCLUDE_PREFIXES, ...cfg.exclude_prefixes].some((x) => underPrefix(p, x));
}

/** Aturan yang berlaku untuk rute ini (bisa lebih dari satu). Rute dikecualikan → []. */
export function rulesForPath(path: string, cfg: PaktaConfig): PaktaRouteRule[] {
	const p = normPath(path);
	if (isExcludedPath(p, cfg)) return [];
	return cfg.route_rules.filter((r) => underPrefix(p, r.path_prefix));
}

export function itemMatchesRule(item: UnconfirmedItem, rule: PaktaRouteRule): boolean {
	const m = rule.match;
	if (item.type === 'gate') return !!item.gate_key && !!m.gate_keys?.includes(item.gate_key); // gate hanya cocok lewat gate_keys (bukan kata kunci)
	if (item.type === 'sop' && item.sop_id != null && m.sop_ids?.includes(item.sop_id)) return true;
	if (item.type === 'flow' && item.flow_key && m.flow_keys?.includes(item.flow_key)) return true;
	const code = String(item.sop_code ?? '').trim().toLowerCase();
	if (code && m.sop_codes?.includes(code)) return true;
	if (m.keywords?.length) {
		const hay = [item.title, item.flow_key, item.sop_code, item.kategori_sop, item.sub_kategori]
			.map((x) => String(x ?? '').toLowerCase())
			.join(' ');
		if (m.keywords.some((k) => hay.includes(k))) return true;
	}
	return false;
}

export const itemKey = (i: Pick<UnconfirmedItem, 'type' | 'flow_key' | 'sop_id'> & { gate_key?: string | null }): string =>
	i.type === 'gate' ? `gate:${i.gate_key}` : i.type === 'flow' ? `flow:${i.flow_key}` : `sop:${i.sop_id}`;

/** Item belum-dikonfirmasi yang relevan untuk rute ini (unik per dokumen). */
export function itemsForPath(items: UnconfirmedItem[], path: string, cfg: PaktaConfig): { items: UnconfirmedItem[]; label: string | null } {
	const rules = rulesForPath(path, cfg);
	if (!rules.length) return { items: [], label: null };
	const seen = new Set<string>();
	const out: UnconfirmedItem[] = [];
	for (const it of Array.isArray(items) ? items : []) {
		if (rules.some((r) => itemMatchesRule(it, r))) {
			const k = itemKey(it);
			if (!seen.has(k)) {
				seen.add(k);
				out.push(it);
			}
		}
	}
	return { items: out, label: rules.find((r) => r.label)?.label ?? null };
}

/** Status tindak lanjut keberatan per dokumen (dari koleksi pakta_persetujuan; kosong bila koleksi belum ada). */
export type PaktaObjectionStatus = 'menunggu' | 'dispensasi' | 'ditolak';

export interface PaktaDecision {
	/** Tampilkan sesuatu ke pengguna? (shadow = tidak) */
	show: boolean;
	/** 'banner' (warn) tidak mengganggu; 'modal' (soft/hard) menutup layar kegiatan */
	presentation: 'none' | 'banner' | 'modal';
	/** true → layar kegiatan TIDAK bisa ditutup sebelum setuju / dispensasi */
	blocked: boolean;
	/** true → boleh "Lanjut dengan catatan" (soft) */
	canProceedWithNote: boolean;
	/** Item yang masih menahan (tanpa dispensasi) */
	pending: UnconfirmedItem[];
	/** Item yang sudah diberi dispensasi atasan (tidak menahan) */
	dispensed: UnconfirmedItem[];
}

/**
 * Keputusan penguncian. Aturan:
 *  • shadow: tidak tampil (hanya dicatat server).    • warn: banner, tidak menahan.
 *  • soft: modal; boleh lanjut dengan catatan keberatan.   • hard: modal menahan sampai setuju ATAU atasan beri dispensasi.
 * Keberatan 'menunggu'/'ditolak' tidak membuka kunci pada hard; hanya 'dispensasi' yang membuka.
 */
export function decidePakta(input: {
	gateMode: PaktaGateMode;
	items: UnconfirmedItem[];
	objections?: Record<string, PaktaObjectionStatus | undefined>;
}): PaktaDecision {
	const objections = input.objections || {};
	const dispensed = input.items.filter((i) => objections[itemKey(i)] === 'dispensasi');
	const pending = input.items.filter((i) => objections[itemKey(i)] !== 'dispensasi');
	const none: PaktaDecision = { show: false, presentation: 'none', blocked: false, canProceedWithNote: false, pending, dispensed };
	if (pending.length === 0) return none;
	switch (input.gateMode) {
		case 'hard':
			return { show: true, presentation: 'modal', blocked: true, canProceedWithNote: false, pending, dispensed };
		case 'soft':
			return { show: true, presentation: 'modal', blocked: false, canProceedWithNote: true, pending, dispensed };
		case 'warn':
			return { show: true, presentation: 'banner', blocked: false, canProceedWithNote: false, pending, dispensed };
		default:
			return none;
	}
}

/**
 * Kotak "Saya paham" baru aktif setelah (a) waktu baca minimum lewat dan (b) bila diwajibkan, ringkasan sudah di-scroll sampai bawah.
 * Mencegah asal centang (blind ticking) tanpa membuat pekerja menunggu lama — nilai dari setelan Super Admin.
 */
export function bolehCentang(input: { elapsedSec: number; minSec: number; scrolledToEnd: boolean; requireScroll: boolean }): boolean {
	const min = Number.isFinite(input.minSec) && input.minSec > 0 ? input.minSec : 0;
	if (input.elapsedSec < min) return false;
	return !input.requireScroll || input.scrolledToEnd;
}

/** Teks bantu di bawah kotak centang yang masih terkunci (null bila sudah boleh). */
export function alasanBelumBolehCentang(input: { elapsedSec: number; minSec: number; scrolledToEnd: boolean; requireScroll: boolean }): string | null {
	if (bolehCentang(input)) return null;
	const sisa = Math.ceil(Math.max(0, (input.minSec || 0) - input.elapsedSec));
	if (sisa > 0) return `Baca dulu ringkasan di atas — kotak aktif dalam ${sisa} detik.`;
	return 'Gulir ringkasan sampai bawah agar kotak persetujuan aktif.';
}

export interface PaktaSayaItem {
	key: string;
	type: 'sop' | 'flow' | 'gate';
	id: number;
	title: string | null;
	sop_code: string | null;
	version: number;
	flow_key: string | null;
	sop_id: number | null;
	gate_key: string | null;
	/** Awalan rute kegiatan yang dikunci oleh item ini (untuk tombol "Buka kegiatan") */
	route: string | null;
	label: string | null;
	/** Kendala yang sudah diajukan pekerja untuk item ini (null = belum ada) */
	status_kendala: PaktaObjectionStatus | null;
}

/**
 * Daftar "Pakta & Aturan Saya" untuk dropdown header: semua item yang belum disetujui dan TERKAIT aturan rute (item tanpa rute tidak
 * dikunci di halaman mana pun, jadi bukan beban pakta). Dikelompokkan: prosedur kerja (SOP/Alur) vs aturan sistem (gate).
 * Item yang sudah diberi dispensasi atasan tidak dihitung. Tiap item membawa rute kegiatan pertama yang cocok.
 */
export function listPaktaSaya(
	unconfirmed: UnconfirmedItem[],
	cfg: PaktaConfig,
	objections: Record<string, PaktaObjectionStatus | undefined> = {}
): { count: number; prosedur: PaktaSayaItem[]; gate: PaktaSayaItem[] } {
	const prosedur: PaktaSayaItem[] = [];
	const gate: PaktaSayaItem[] = [];
	const seen = new Set<string>();
	for (const it of Array.isArray(unconfirmed) ? unconfirmed : []) {
		const key = itemKey(it);
		if (seen.has(key)) continue;
		const rule = cfg.route_rules.find((r) => !isExcludedPath(r.path_prefix, cfg) && itemMatchesRule(it, r));
		if (!rule) continue;
		const status = objections[key] ?? null;
		if (status === 'dispensasi') continue;
		seen.add(key);
		const row: PaktaSayaItem = {
			key, type: it.type, id: it.id, title: it.title ?? null, sop_code: it.sop_code ?? null, version: it.version,
			flow_key: it.flow_key ?? null, sop_id: it.sop_id ?? null, gate_key: it.gate_key ?? null,
			route: rule.path_prefix, label: rule.label ?? null, status_kendala: status
		};
		(it.type === 'gate' ? gate : prosedur).push(row);
	}
	return { count: prosedur.length + gate.length, prosedur, gate };
}
