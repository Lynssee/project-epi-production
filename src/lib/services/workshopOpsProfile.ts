// src/lib/services/workshopOpsProfile.ts
// Profil Workshop Ops lapangan per workshop (Ciketing & Balaraja) — Fase 7c Unifikasi Workshop.
// Murni data, aman klien & server. Perbedaan skema DISENGAJA dipetakan di sini, bukan tersebar:
//   - tabel laporan harian (workshop_daily_report / _po_detail / _material) SATU untuk kedua workshop,
//     dibedakan kolom workshop_id (1=Ciketing, 2=Balaraja).
//   - SJ Masuk / SJ Keluar / Tiket Kerja koleksi terpisah per workshop.
//   - kolom `kondisi_barang` (checklist penerimaan) ada di kedua koleksi SJ Masuk (Balaraja ditambahkan belakangan);
//     flag sjmHasKondisi dipertahankan agar mudah dimatikan bila skema suatu workshop berubah.
//   - balaraja_item tidak punya `stok_tersedia` → stok dihitung dari ledger.
//   - Overstay & PO Bayangan bergantung pada ciketing_customer_placement (rak) → hanya Ciketing.
export type OpsWorkshopKey = 'ciketing' | 'balaraja';

export interface WorkshopOpsProfile {
	key: OpsWorkshopKey;
	id: number;
	label: string;
	projectWorkshop: string;
	sjMasuk: string;
	sjKeluar: string;
	workTicket: string;
	itemCollection: string;
	ledgerCollection: string;
	sjmHasKondisi: boolean;
	stockColumn: boolean;
	hasOverstay: boolean;
	hasPoBayangan: boolean;
}

export const WORKSHOP_OPS: Record<OpsWorkshopKey, WorkshopOpsProfile> = {
	ciketing: {
		key: 'ciketing',
		id: 1,
		label: 'Ciketing',
		projectWorkshop: 'ciketing',
		sjMasuk: 'ciketing_surat_jalan_masuk',
		sjKeluar: 'ciketing_surat_jalan_keluar',
		workTicket: 'ciketing_work_ticket',
		itemCollection: 'ciketing_item',
		ledgerCollection: 'ciketing_stok_ledger',
		sjmHasKondisi: true,
		stockColumn: true,
		hasOverstay: true,
		hasPoBayangan: true
	},
	balaraja: {
		key: 'balaraja',
		id: 2,
		label: 'Balaraja',
		projectWorkshop: 'balaraja',
		sjMasuk: 'balaraja_surat_jalan_masuk',
		sjKeluar: 'balaraja_surat_jalan_keluar',
		workTicket: 'balaraja_work_ticket',
		itemCollection: 'balaraja_item',
		ledgerCollection: 'balaraja_stok_ledger',
		sjmHasKondisi: true, // kolom ditambahkan ke balaraja_surat_jalan_masuk (gap Unifikasi Workshop)
		stockColumn: false,
		hasOverstay: false,
		hasPoBayangan: false
	}
};

/** Profil dari kunci apa pun; nilai tak dikenal/kosong → Ciketing (perilaku lama, aman untuk entri antrian offline lama). */
export function opsProfile(ws?: string | null): WorkshopOpsProfile {
	return ws === 'balaraja' ? WORKSHOP_OPS.balaraja : WORKSHOP_OPS.ciketing;
}

/**
 * Profil untuk JALUR TULIS (WSK-12): TIDAK ada default diam-diam ke Ciketing. `ws` kosong/tak dikenal = galat jelas,
 * supaya laporan Balaraja tak pernah tercatat sebagai Ciketing. `opsProfile()` yang longgar hanya untuk tampilan/baca.
 */
export function requireOpsProfile(ws?: string | null): WorkshopOpsProfile {
  if (ws !== 'ciketing' && ws !== 'balaraja') throw new Error('Workshop belum dipilih (ws kosong). Muat ulang halaman.');
  return WORKSHOP_OPS[ws];
}

/** Normalisasi nilai ?ws= / localStorage ke kunci valid. */
export function parseOpsWorkshop(v: unknown): OpsWorkshopKey {
	return v === 'balaraja' ? 'balaraja' : 'ciketing';
}
