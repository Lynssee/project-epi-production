// src/lib/server/equipmentHubCore.ts
// Logika MURNI (tanpa I/O) Hub Equipment 360° — dipakai endpoint /api/equipment/hub & /api/equipment/resolve-item.
// Semua perilaku yang bisa berubah (tab, profil aktivitas per kategori, visibilitas nominal Rp) berasal dari fleet_settings
// ('eq_hub_*', diatur di erp-epi Fleet → Setelan) dengan DEFAULT di sini — bukan hardcode permanen (CLAUDE.md #11).
// Mode gate G_EQ_SCAN_HUB_ACCESS hanya menentukan apakah Hub dibuka otomatis setelah scan (shadow = tidak), tidak pernah memblokir.

export const GATE_EQ_SCAN_HUB = 'G_EQ_SCAN_HUB_ACCESS';
export const DOC_EQ_SCAN_HUB = 'equipment';

export type HubTab = 'perbaikan' | 'p2h' | 'pembelian' | 'pemakaian' | 'spesifikasi';
export type HubActionId = 'p2h' | 'lapor' | 'pm' | 'booking' | 'komponen' | 'hm' | 'pinjam' | 'sop';

export const ALL_HUB_TABS: HubTab[] = ['perbaikan', 'p2h', 'pembelian', 'pemakaian', 'spesifikasi'];
export const ALL_HUB_ACTIONS: HubActionId[] = ['p2h', 'lapor', 'pm', 'booking', 'komponen', 'hm', 'pinjam', 'sop'];

export interface HubProfile {
	kataKunci: string[];
	aksi: HubActionId[];
}

export interface HubSettings {
	showCost: boolean;
	costPermissions: string[];
	tabs: HubTab[];
	profiles: Record<string, HubProfile>;
}

export const GENERIC_ACTIONS: HubActionId[] = ['p2h', 'lapor', 'pm'];

export const DEFAULT_HUB_SETTINGS: HubSettings = {
	showCost: false,
	costPermissions: ['admin_panel'],
	tabs: [...ALL_HUB_TABS],
	profiles: {
		kendaraan: { kataKunci: ['kendaraan', 'mobil', 'motor', 'truk'], aksi: ['p2h', 'lapor', 'booking', 'komponen', 'pm'] },
		alat_berat: { kataKunci: ['compressor', 'kompresor', 'forklift', 'airless', 'genset', 'crane'], aksi: ['p2h', 'hm', 'pm', 'lapor', 'pinjam'] },
		mesin_qc: { kataKunci: ['mesin', 'alat ukur', 'instrumen', 'kalibrasi'], aksi: ['p2h', 'sop', 'lapor', 'pm'] },
		fasilitas: { kataKunci: ['bangunan', 'fasilitas', 'sipil'], aksi: ['p2h', 'lapor'] }
	}
};

export const HUB_SETTING_KEYS = ['eq_hub_tampil_biaya', 'eq_hub_izin_biaya', 'eq_hub_tab_aktif', 'eq_hub_profil'] as const;

const asBool = (v: unknown, fb: boolean) => (v === true || v === 'true' || v === 1 ? true : v === false || v === 'false' || v === 0 ? false : fb);

function parseJson(v: unknown): unknown {
	if (typeof v !== 'string') return v;
	try {
		return JSON.parse(v);
	} catch {
		return undefined;
	}
}

export function normalizeHubSettings(rows: { key: string; value: unknown }[] | null | undefined): HubSettings {
	const m = new Map((rows || []).map((r) => [String(r.key), r.value]));

	const permRaw = m.get('eq_hub_izin_biaya');
	const costPermissions =
		permRaw == null
			? [...DEFAULT_HUB_SETTINGS.costPermissions]
			: String(permRaw)
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean); // string kosong disengaja = tak seorang pun

	const tabsRaw = parseJson(m.get('eq_hub_tab_aktif'));
	let tabs = DEFAULT_HUB_SETTINGS.tabs;
	if (Array.isArray(tabsRaw)) {
		const picked = tabsRaw.map(String).filter((t): t is HubTab => (ALL_HUB_TABS as string[]).includes(t));
		if (picked.length) tabs = [...new Set(picked)];
	}

	const profRaw = parseJson(m.get('eq_hub_profil'));
	let profiles = DEFAULT_HUB_SETTINGS.profiles;
	if (profRaw && typeof profRaw === 'object' && !Array.isArray(profRaw)) {
		const out: Record<string, HubProfile> = {};
		for (const [key, val] of Object.entries(profRaw as Record<string, any>)) {
			const kata = Array.isArray(val?.kata_kunci) ? val.kata_kunci.map((s: unknown) => String(s).trim().toLowerCase()).filter(Boolean) : [];
			const aksi = Array.isArray(val?.aksi) ? val.aksi.map(String).filter((a: string): a is HubActionId => (ALL_HUB_ACTIONS as string[]).includes(a)) : [];
			if (kata.length && aksi.length) out[key] = { kataKunci: kata, aksi: [...new Set(aksi)] as HubActionId[] };
		}
		if (Object.keys(out).length) profiles = out;
	}

	return {
		showCost: asBool(m.get('eq_hub_tampil_biaya'), DEFAULT_HUB_SETTINGS.showCost),
		costPermissions,
		tabs,
		profiles
	};
}

/** Cocokkan nama kategori (parent_category + nama category) ke kunci profil; tak cocok → 'umum'. */
export function resolveProfileKey(parentCategory: string | null | undefined, categoryName: string | null | undefined, profiles: Record<string, HubProfile>): string {
	const hay = `${parentCategory || ''} ${categoryName || ''}`.toLowerCase();
	if (!hay.trim()) return 'umum';
	for (const [key, p] of Object.entries(profiles)) {
		if (p.kataKunci.some((k) => hay.includes(k))) return key;
	}
	return 'umum';
}

export function actionsForProfile(profileKey: string, profiles: Record<string, HubProfile>): HubActionId[] {
	return profiles[profileKey]?.aksi ? [...profiles[profileKey].aksi] : [...GENERIC_ACTIONS];
}

export interface HubActionDef {
	id: HubActionId;
	label: string;
	hint: string;
	/** href tujuan; `tab:<nama>` berarti buka tab Hub, bukan pindah halaman. */
	href: string;
	group: 'Inspeksi & Checklist' | 'Perawatan & Lapor Rusak' | 'Operasional & Peminjaman';
}

/** Katalog aksi (label/hint/rute). Rute dikonfirmasi ada di project-epi: p2h, pm, survey/baru, fleet-booking, pinjaman-saya, panduan. */
export function buildActionDef(id: HubActionId, equipmentId: string): HubActionDef {
	const eid = encodeURIComponent(equipmentId);
	switch (id) {
		case 'p2h':
			return { id, label: 'Isi Checklist P2H', hint: 'Pemeriksaan harian unit sebelum dipakai (kondisi, KM/HM, foto bila ada temuan).', href: `/preventive/p2h/${eid}`, group: 'Inspeksi & Checklist' };
		case 'hm':
			return { id, label: 'Update Hoursmeter', hint: 'HM/KM dicatat lewat form P2H agar tercatat bersama kondisi unit.', href: `/preventive/p2h/${eid}`, group: 'Inspeksi & Checklist' };
		case 'komponen':
			return { id, label: 'Inspeksi Komponen (Ban/Aki)', hint: 'Lihat komponen terpasang di tab Perbaikan, lalu scan QR komponen untuk mencatat kondisinya.', href: 'tab:perbaikan', group: 'Inspeksi & Checklist' };
		case 'sop':
			return { id, label: 'Buka Panduan SOP', hint: 'Panduan pengoperasian & alur kerja terkait unit/mesin ini.', href: '/panduan', group: 'Inspeksi & Checklist' };
		case 'lapor':
			return { id, label: 'Lapor Kerusakan', hint: 'Buat laporan kerusakan/servis; tim Maintenance menindaklanjuti.', href: `/maintenance/survey/baru?equipment_id=${eid}`, group: 'Perawatan & Lapor Rusak' };
		case 'pm':
			return { id, label: 'Cek / Eksekusi PM', hint: 'Jadwal perawatan berkala (ganti oli, filter, dll) yang jatuh tempo.', href: `/preventive/pm/${eid}`, group: 'Perawatan & Lapor Rusak' };
		case 'booking':
			return { id, label: 'Buat Booking / Alih Pakai', hint: 'Ajukan booking armada agar pemakaian tercatat; alih pakai darurat tersedia di kartu pemegang unit.', href: '/fleet-booking', group: 'Operasional & Peminjaman' };
		case 'pinjam':
			return { id, label: 'Konfirmasi Peminjaman Alat', hint: 'Lihat & konfirmasi peminjaman alat kerja atas nama Anda.', href: '/maintenance/pinjaman-saya', group: 'Operasional & Peminjaman' };
	}
}

export function buildActions(profileKey: string, profiles: Record<string, HubProfile>, equipmentId: string): HubActionDef[] {
	return actionsForProfile(profileKey, profiles).map((id) => buildActionDef(id, equipmentId));
}

/** Sensor nominal Rp pada baris pembelian bila pemanggil tak berhak. Mutasi-bebas (mengembalikan salinan). */
export function redactCost<T extends Record<string, any>>(rows: T[], allowed: boolean): T[] {
	if (allowed) return rows;
	return rows.map((r) => {
		const c: Record<string, any> = { ...r };
		for (const k of ['unitPrice', 'totalPrice', 'discountAmount', 'discountPct', 'poTotalAmount', 'lastPrice']) if (k in c) c[k] = null;
		return c as T;
	});
}

export type ExpiryLevel = 'ok' | 'soon' | 'expired' | 'unknown';
export interface ExpiryInfo {
	key: 'stnk' | 'pajak' | 'kir';
	label: string;
	date: string | null;
	daysLeft: number | null;
	level: ExpiryLevel;
}

/** Banner masa berlaku dokumen kendaraan. `soonDays` = ambang peringatan (hari). */
export function computeExpiry(
	equipment: { stnk_expiry?: string | null; tax_expiry?: string | null; kir_expiry?: string | null },
	nowMs = Date.now(),
	soonDays = 30
): ExpiryInfo[] {
	const defs: Array<[ExpiryInfo['key'], string, string | null | undefined]> = [
		['stnk', 'STNK', equipment.stnk_expiry],
		['pajak', 'Pajak', equipment.tax_expiry],
		['kir', 'KIR', equipment.kir_expiry]
	];
	return defs
		.filter(([, , d]) => !!d)
		.map(([key, label, d]) => {
			const t = Date.parse(`${String(d).slice(0, 10)}T23:59:59`);
			if (!Number.isFinite(t)) return { key, label, date: String(d), daysLeft: null, level: 'unknown' as ExpiryLevel };
			const daysLeft = Math.floor((t - nowMs) / 86_400_000);
			const level: ExpiryLevel = daysLeft < 0 ? 'expired' : daysLeft <= soonDays ? 'soon' : 'ok';
			return { key, label, date: String(d).slice(0, 10), daysLeft, level };
		});
}
