// src/lib/kiosk/profilGudang.ts
// MURNI (tanpa import server/Directus). Briefing Gate Dua Tingkat & Eliminasi Skema Manual, Bab VI §6.3-A
// (21 Sep 2026): tiga profil kiosk dari satu basis kode — RM / FG / Central. Profil ditentukan dari
// GUDANG tempat terminal berada (bukan menu terpisah), dipetakan lewat system_settings 'inventory.kiosk.profil_*'
// (`kiosk_profil_gudang` = {"<gudang_id>":"rm"|"fg"|"central"}, `kiosk_profil_default`), bukan hardcode.
//
// Aman-mundur: bila terminal belum dipetakan (profil = null) SEMUA menu tampil seperti sebelumnya.

export type ProfilKiosk = 'rm' | 'fg' | 'central';

export type MenuGudangKey =
	| 'cek-stok'
	| 'peta'
	| 'antrian'
	| 'persiapan'
	| 'opname'
	| 'konsumsi'
	| 'fg-terima'
	| 'muat-sj'
	| 'transfer';

export const PROFIL_LABEL: Record<ProfilKiosk, string> = {
	rm: 'Raw Material',
	fg: 'Finish Good',
	central: 'Central'
};

/** Menu Gudang per profil. Transfer antar gudang tersedia di semua profil. */
export const MENU_PER_PROFIL: Record<ProfilKiosk, MenuGudangKey[]> = {
	rm: ['cek-stok', 'peta', 'persiapan', 'konsumsi', 'opname', 'transfer'],
	fg: ['cek-stok', 'peta', 'antrian', 'fg-terima', 'muat-sj', 'opname', 'transfer'],
	central: ['cek-stok', 'peta', 'antrian', 'persiapan', 'opname', 'transfer']
};

export const SEMUA_MENU: MenuGudangKey[] = [
	'cek-stok', 'peta', 'antrian', 'persiapan', 'opname', 'konsumsi', 'fg-terima', 'muat-sj', 'transfer'
];

export function isProfil(v: unknown): v is ProfilKiosk {
	return v === 'rm' || v === 'fg' || v === 'central';
}

/** Menu yang tampil. profil null/tak dikenal → semua (perilaku sebelum fitur ini). */
export function menusForProfil(profil: ProfilKiosk | null | undefined): MenuGudangKey[] {
	return isProfil(profil) ? MENU_PER_PROFIL[profil] : SEMUA_MENU;
}

/** Parse nilai system_settings (string JSON atau objek). Entri tak valid dibuang, tidak melempar. */
export function parseProfilMap(raw: unknown): Record<string, ProfilKiosk> {
	let obj: unknown = raw;
	if (typeof raw === 'string') {
		try {
			obj = JSON.parse(raw);
		} catch {
			return {};
		}
	}
	if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
	const out: Record<string, ProfilKiosk> = {};
	for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
		if (isProfil(v)) out[String(k)] = v;
	}
	return out;
}

/**
 * Profil untuk satu gudang. `ancestors` = id leluhur TERDEKAT dulu (induk, kakek, ...): pemetaan pada
 * gudang itu sendiri menang atas leluhur; bila tak ada → default; bila default juga kosong → null.
 */
export function resolveProfil(
	map: Record<string, ProfilKiosk>,
	gudangId: number | null | undefined,
	ancestors: number[] = [],
	defaultProfil: ProfilKiosk | null = null
): ProfilKiosk | null {
	const chain = gudangId == null ? [] : [gudangId, ...ancestors];
	for (const id of chain) {
		const p = map[String(id)];
		if (p) return p;
	}
	return defaultProfil;
}
