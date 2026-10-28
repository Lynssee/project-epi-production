// src/lib/data/p2hChecklist.ts
// ESS Redesign — P2H (Pemeriksaan Pra-Harian) terikat FISIK kendaraan, bukan profesi.
// Sumber kebenaran daftar item = fleet_settings.checklist_template_peminjam (config-driven,
// bisa diubah admin lewat /fleet > Pengaturan). Konstanta di bawah hanya FALLBACK bila
// setting itu belum terisi / gagal dibaca — supaya P2H tetap jalan (fail-safe, bukan blank).

export interface P2HTemplateItem {
	key: string;
	label: string;
	kritis: boolean;
	wajib_foto?: boolean;
}

/** Fallback 12 item — selaras dengan seed default checklist_template_peminjam (Peminjaman v2 Fase 2). */
export const DEFAULT_P2H_TEMPLATE: P2HTemplateItem[] = [
	{ key: 'rem', label: 'Rem & Rem Tangan', kritis: true },
	{ key: 'ban', label: 'Kondisi Ban (tekanan & keausan)', kritis: true },
	{ key: 'lampu', label: 'Lampu Utama, Sein & Hazard', kritis: true },
	{ key: 'oli_mesin', label: 'Oli Mesin', kritis: false },
	{ key: 'air_radiator', label: 'Air Radiator', kritis: false },
	{ key: 'air_wiper', label: 'Air Wiper', kritis: false },
	{ key: 'aki', label: 'Aki / Kelistrikan', kritis: false },
	{ key: 'klakson', label: 'Klakson', kritis: false },
	{ key: 'wiper', label: 'Karet Wiper', kritis: false },
	{ key: 'ban_serep', label: 'Ban Serep', kritis: false },
	{ key: 'dongkrak', label: 'Dongkrak & Kunci Roda', kritis: false },
	{ key: 'dashboard', label: 'Foto Dashboard (odometer & indikator BBM)', kritis: false, wajib_foto: true }
];

/** Normalisasi item dari config/DB ke bentuk P2HTemplateItem. Toleran nama field lama. */
export function normalizeP2HTemplate(raw: any[]): P2HTemplateItem[] {
	if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_P2H_TEMPLATE;
	return raw.map((r, i) => ({
		key: String(r.key ?? r.name ?? `item_${i}`),
		label: String(r.label ?? r.name ?? r.key ?? `Item ${i + 1}`),
		kritis: !!r.kritis,
		wajib_foto: !!r.wajib_foto
	}));
}
