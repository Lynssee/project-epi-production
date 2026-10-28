// src/lib/utils/draftTier1Config.ts
// Pembaca config rollout Lapis 1 (Fase 4, rencana Draf Otomatis Universal v2) sisi
// lapangan. app_settings (module='global') diedit admin lewat erp-epi
// (/settings/draft-otomatis) — project-epi HANYA membaca lewat modul ini, tidak
// pernah menulis, dan tidak punya UI edit sendiri (sesuai CLAUDE.md: app_settings
// diedit admin, project-epi konsumen). Bukan mesin settings ke-3 — cuma pembaca.
//
// Default AMAN kalau baris app_settings belum ada: enabled=false, groups=[] —
// shadow, tidak ada form yang ikut ter-scan sampai admin menyalakannya eksplisit.
import { secureDirectusJson } from '$lib/services/secureDirectus';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 menit, sama seperti pola rndSettings.js

export interface DraftTier1Config {
	enabled: boolean;
	groups: string[];
}

const DEFAULTS: DraftTier1Config = { enabled: false, groups: [] };

let cached: DraftTier1Config | null = null;
let cachedAt = 0;
let inFlight: Promise<DraftTier1Config> | null = null;

interface AppSettingRow {
	setting_key: string;
	setting_type: string;
	setting_value: unknown;
}

async function fetchFresh(): Promise<DraftTier1Config> {
	try {
		const res = await secureDirectusJson<{ data: AppSettingRow[] }>(
			'items/app_settings?filter[module][_eq]=global&limit=-1'
		);
		const rows = res?.data || [];
		const enabledRow = rows.find((r) => r.setting_key === 'draft.tier1_enabled');
		const groupsRow = rows.find((r) => r.setting_key === 'draft.tier1_module_groups');
		let groups = DEFAULTS.groups;
		if (groupsRow?.setting_value) {
			try {
				const raw = groupsRow.setting_value;
				const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
				if (Array.isArray(parsed)) groups = parsed;
			} catch {
				// abaikan, pakai default []
			}
		}
		const enabledRaw = enabledRow?.setting_value;
		return {
			enabled: enabledRaw === true || enabledRaw === 'true',
			groups
		};
	} catch (e) {
		console.warn('[draftTier1Config] Gagal memuat config rollout — pakai default (off):', e);
		return DEFAULTS;
	}
}

export async function getDraftTier1Config(): Promise<DraftTier1Config> {
	const now = Date.now();
	if (cached && now - cachedAt < CACHE_TTL_MS) return cached;
	if (inFlight) return inFlight;
	inFlight = fetchFresh().then((result) => {
		cached = result;
		cachedAt = Date.now();
		inFlight = null;
		return result;
	});
	return inFlight;
}

export const DRAFT_TIER1_MODULE_GROUPS: { key: string; label: string; prefixes: string[] }[] = [
	{ key: 'requisition', label: 'Requisition & Pengajuan Barang', prefixes: ['/requisition'] },
	{ key: 'kiosk_produksi', label: 'Kiosk Produksi', prefixes: ['/kiosk'] },
	{ key: 'hse', label: 'HSE / JSA / Inspeksi', prefixes: ['/hse', '/jsa', '/inspeksi'] },
	{ key: 'laporan', label: 'Laporan Harian Proyek', prefixes: ['/laporan'] },
	{ key: 'ess', label: 'ESS (Self-Service Karyawan)', prefixes: ['/ess'] }
];

export function routePrefixesForGroups(groups: string[]): string[] {
	return DRAFT_TIER1_MODULE_GROUPS.filter((g) => groups.includes(g.key)).flatMap((g) => g.prefixes);
}
