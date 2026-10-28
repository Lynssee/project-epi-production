// src/lib/kiosk/workshopKiosk.ts
// Profil kiosk per workshop (Ciketing & Balaraja) — Fase 7 Unifikasi Workshop. Aman untuk klien &
// server (murni data). Perbedaan skema DISENGAJA ada di sini, bukan tersebar di handler:
//   - stok     : ciketing_item punya kolom `stok_tersedia`; balaraja_item TIDAK (stok = jumlah ledger IN − OUT).
//   - ledger   : kolom `identitas_barang_id` hanya ada di ciketing_stok_ledger.
//   - menu     : kunci kiosk_menu_access per workshop (lihat kioskMenus.ts, cermin erp-epi).
export type WorkshopKey = 'ciketing' | 'balaraja';

export interface WorkshopKioskProfile {
	key: WorkshopKey;
	/** Nama pendek untuk tampilan: "Ciketing" / "Balaraja". */
	label: string;
	/** Tag di header kiosk. */
	tag: string;
	itemCollection: string;
	ledgerCollection: string;
	/** true → saldo disimpan di kolom `stok_tersedia` pada item; false → dihitung dari ledger. */
	stockColumn: boolean;
	ledgerHasIdentitas: boolean;
	/** Nilai kolom projects.workshop untuk daftar SPK. */
	projectWorkshop: string;
	menuCekStok: 'ciketing_cek_stok' | 'balaraja_cek_stok';
	menuPotongBahan: 'ciketing_potong_bahan' | 'balaraja_potong_bahan';
}

export const WORKSHOP_KIOSK: Record<WorkshopKey, WorkshopKioskProfile> = {
	ciketing: {
		key: 'ciketing',
		label: 'Ciketing',
		tag: 'WS Ciketing',
		itemCollection: 'ciketing_item',
		ledgerCollection: 'ciketing_stok_ledger',
		stockColumn: true,
		ledgerHasIdentitas: true,
		projectWorkshop: 'ciketing',
		menuCekStok: 'ciketing_cek_stok',
		menuPotongBahan: 'ciketing_potong_bahan'
	},
	balaraja: {
		key: 'balaraja',
		label: 'Balaraja',
		tag: 'MB Balaraja',
		itemCollection: 'balaraja_item',
		ledgerCollection: 'balaraja_stok_ledger',
		stockColumn: false,
		ledgerHasIdentitas: false,
		projectWorkshop: 'balaraja',
		menuCekStok: 'balaraja_cek_stok',
		menuPotongBahan: 'balaraja_potong_bahan'
	}
};

export function isWorkshopKey(v: unknown): v is WorkshopKey {
	return v === 'ciketing' || v === 'balaraja';
}

/** Profil workshop atau lempar Error jelas (jangan diam-diam jatuh ke Ciketing). */
export function requireKioskProfile(v: unknown): WorkshopKioskProfile {
	if (!isWorkshopKey(v)) throw new Error(`Workshop tidak dikenal: "${String(v)}"`);
	return WORKSHOP_KIOSK[v];
}
