// src/lib/server/gerbangSj/types.ts
// GSP-01/04 — tipe & konstanta bersama modul Gerbang SJ satu pintu (kiosk · app HP · ERP).

export type GateSumber = 'kiosk' | 'app' | 'erp';

export type GateActor = {
	sumber: GateSumber;
	/** WAJIB ada — dipakai satpam_pencatat_id & scan_log.actor_id */
	karyawanId: number;
	/** karyawan.nama_karyawan (bukan email) */
	nama: string;
	email: string | null;
	/** `${SUMBER_UPPER}/${nama}` mis. 'KIOSK/BUDI SANTOSO' */
	label: string;
};

/** Nilai scan_log.source per sumber (GSP-02 §4.3). */
export const SCAN_SOURCE_BY_SUMBER: Record<GateSumber, 'kiosk' | 'lapangan' | 'admin'> = {
	kiosk: 'kiosk',
	app: 'lapangan',
	erp: 'admin'
};

/** Satu sumber kode untuk teks & warna di ketiga layar (GSP-04 §4.6). */
export const GATE_KODE = [
	'SUDAH_LOLOS', 'DATA_TIDAK_KONSISTEN', 'BELUM_SIAP_GERBANG', 'BELUM_DISETUJUI', 'DITOLAK_APPROVER',
	'PERNAH_DITAHAN', 'RANGKAP_BELUM', 'KOLI_TIDAK_TERCATAT', 'CLIENT_EVENT_ID_WAJIB', 'CEK_BELUM_LENGKAP',
	'KOLI_BEDA', 'KOLI_WAJIB_DIHITUNG', 'ITEM_BELUM_DICEK', 'ADA_SELISIH_ITEM', 'FOTO_TIDAK_VALID',
	'ALASAN_WAJIB', 'KATEGORI_TIDAK_DIKENAL', 'TIDAK_BISA_DITAHAN', 'STATUS_BERUBAH', 'QR_TIDAK_COCOK',
	'SERVER_LAPANGAN_TIDAK_TERJANGKAU',
	// WSK-35: kunci pembuat SJ ≠ satpam (fallback alasan + notifikasi atasan)
	'VERIFIKASI_SENDIRI_ALASAN_WAJIB', 'VERIFIKASI_SENDIRI_DIBLOKIR',
	// Blocker SJH-12 yang sudah ada sebelum GSP (guard cetak/barang bermasalah/gate ERP) — dipertahankan.
	'BELUM_DICETAK', 'BARANG_BERMASALAH', 'GATE',
	// Umum
	'TIDAK_DITEMUKAN', 'INPUT_TIDAK_VALID', 'TIDAK_ADA_AKSES', 'BELUM_LOGIN'
] as const;
export type GateKode = (typeof GATE_KODE)[number];

export type GateBlocker = { kode: GateKode; pesan: string; siapa: string | null };
export type GateWarning = { kode: GateKode; pesan: string };

export const KATEGORI_TAHAN = ['koli', 'plat', 'driver', 'item', 'dokumen', 'lainnya'] as const;
export type KategoriTahan = (typeof KATEGORI_TAHAN)[number];

export type GateItemCheck = { sj_item_id: number; ok: boolean; catatan?: string | null };
export type GateGps = { lat: number; lng: number; accuracy: number | null };
export type GateChecklistInput = { jumlah_ok?: boolean | null; plat_ok?: boolean | null; driver_ok?: boolean | null };

export type LoloskanInput = {
	client_event_id: string;
	checklist: GateChecklistInput;
	koli_dihitung?: number | null;
	items?: GateItemCheck[] | null;
	foto_file_id?: string | null;
	gps?: GateGps | null;
	catatan?: string | null;
};

export type TahanInput = {
	client_event_id: string;
	alasan: string;
	kategori: KategoriTahan;
	checklist?: GateChecklistInput | null;
	koli_dihitung?: number | null;
	items?: GateItemCheck[] | null;
	foto_file_id?: string | null;
	gps?: GateGps | null;
};

/** Checklist v2 yang disimpan di surat_jalan.security_checklist (GSP-05/06/07). */
export type GateRiwayat = { hasil: string; kategori?: string | null; alasan?: string | null; oleh_nama?: string | null; sumber?: string | null; waktu?: string | null };
export type GateChecklist = {
	versi: 1 | 2;
	hasil: 'lolos' | 'ditahan' | 'tidak_diketahui';
	sumber?: string | null;
	oleh_id?: number | null;
	oleh_nama?: string | null;
	waktu?: string | null;
	kategori?: string | null;
	alasan?: string | null;
	jumlah_ok?: boolean | null;
	plat_ok?: boolean | null;
	driver_ok?: boolean | null;
	foto?: string | null;
	catatan?: string | null;
	riwayat: GateRiwayat[];
	[k: string]: unknown;
};

export type GateResult = {
	ok: true;
	hasil: 'lolos' | 'ditahan';
	idempoten: boolean;
	sj: { id: number; nomor_sj: string; status: string; track_stage: string | null };
	pesan: string;
	effects_gagal: string[];
};

/** Error terstruktur — route mengubahnya jadi JSON seragam; wrapper lama jadi `error()` SvelteKit. */
export class GateError extends Error {
	constructor(
		public status: number,
		public kode: GateKode,
		public pesan: string,
		public blockers: GateBlocker[] = []
	) {
		super(pesan);
		this.name = 'GateError';
	}
	toJSON() {
		return { ok: false as const, kode: this.kode, pesan: this.pesan, blockers: this.blockers };
	}
}
