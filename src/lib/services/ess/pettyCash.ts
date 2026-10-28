// src/lib/services/ess/pettyCash.ts
// Client-side service ESS Pengajuan Kas Kecil — selalu lewat /api/ess/petty-cash/*.

import { fetchWithTimeout } from '$lib/shared/pettyCashUx';
import imageCompression from 'browser-image-compression';
import { auth } from '$lib/firebase';

export interface PettyCashFund {
	id: number;
	fund_name: string;
	department: string | null;
	/** U8: saldo mentah TIDAK dikirim ke pemohon — hanya tingkatnya */
	balance_level?: 'cukup' | 'rendah' | 'habis';
	ceiling_per_transaksi?: number | string | null;
	wajib_bukti_diatas?: number | string | null;
	lpj_batas_hari?: number | null;
	/** PRJ-22: 'project_imprest' = dana kerja terikat ke satu proyek (project_id). */
	fund_type?: string | null;
	project_id?: number | null;
}

export interface PettyCashRequestRecord {
	id: number;
	request_number: string;
	mode: 'reimburse' | 'advance';
	status: string;
	fund_id: number | { id: number } | null;
	request_date: string;
	needed_date: string | null;
	description: string;
	amount: number;
	approved_amount: number | null;
	payee_name: string | null;
	receipt_number: string | null;
	reject_reason: string | null;
	// BUG-15: alasan revisi/tolak per tahap (bukan hanya reject_reason)
	atasan_action?: string | null;
	atasan_note?: string | null;
	finance_action?: string | null;
	finance_note?: string | null;
	kasir_action?: string | null;
	kasir_note?: string | null;
	bukti_file?: string[] | null;
	advance_settlement_status: string | null;
	settlement_amount: number | null;
	journal_entry_id: number | null;
	hold_reason?: string | null;
	delegated_from_id?: number | null;
	delegated_from_name?: string | null;
	date_updated?: string | null;
	date_created?: string | null;
	lpj_bukti_file?: string[] | null;
	lpj_reject_note?: string | null;
	lpj_rejected_at?: string | null;
	posted_at: string | null;
	requester_name?: string | null;
	is_inventory_in?: boolean | null;
	inventory_item_id?: number | { id: number; nama_barang_lengkap?: string; kode_barang?: string } | null;
	inventory_qty?: number | null;
	gudang_id?: number | { id: number; nama_gudang?: string } | null;
}

/** Label status LPJ uang muka (PC3-13: 'revisi' = dikembalikan kasir, perlu diperbaiki). */
export const SETTLEMENT_LABEL: Record<string, string> = {
	menunggu_lpj: 'Menunggu LPJ',
	lpj_diajukan: 'LPJ menunggu verifikasi kasir',
	lpj_diverifikasi: 'LPJ diverifikasi',
	selesai: 'LPJ selesai',
	revisi: 'LPJ perlu diperbaiki'
};

export const PETTY_CASH_STATUS_LABEL: Record<string, string> = {
	draft: 'Draf',
	menunggu_atasan: 'Menunggu Atasan',
	menunggu_finance: 'Menunggu Finance Pusat',
	menunggu_kasir: 'Menunggu Kasir',
	approved: 'Disetujui',
	posted: 'Diposting',
	rejected: 'Ditolak',
	revisi: 'Perlu Revisi',
	cancelled: 'Dibatalkan'
};

/** Label status tampilan: tiket tertahan saldo dana → "Menunggu isi ulang dana" (PC3-08), bukan "Menunggu Kasir" berhari-hari. */
export function pettyCashStatusLabel(r: { status: string; hold_reason?: string | null }): string {
	if (r.status === 'menunggu_kasir' && r.hold_reason === 'saldo_kurang') return 'Menunggu isi ulang dana';
	return PETTY_CASH_STATUS_LABEL[r.status] || r.status;
}

/** U3 — semua fetch kas kecil berbatas waktu (aksi 20 dtk, unggah foto 45 dtk) supaya spinner tak menggantung. */
const ACTION_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 45_000;
const tfetch = (url: string, init: RequestInit = {}, ms = ACTION_TIMEOUT_MS) => fetchWithTimeout(fetch, url, init, ms);

async function getIdToken(): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return user.getIdToken();
}

/** Error API kas kecil; `code` mis. 'possible_duplicate' (409) supaya UI bisa menawarkan kirim ulang. */
export class PettyCashApiError extends Error {
	code: string | null;
	status: number;
	record?: any;
	constructor(message: string, status: number, code: string | null = null, record?: any) {
		super(message);
		this.name = 'PettyCashApiError';
		this.status = status;
		this.code = code;
		this.record = record;
	}
}

async function parseError(res: Response): Promise<PettyCashApiError> {
	// PC3-06: 413 dari adapter-node bukan JSON ("Gagal (413)" tak dimengerti awam) → pesan + alternatif.
	if (res.status === 413) {
		return new PettyCashApiError(
			'Foto nota terlalu besar untuk dikirim. Hapus foto lalu foto ulang, atau kirim tanpa foto dan serahkan nota fisik ke kasir.',
			413,
			'payload_too_large'
		);
	}
	try {
		const data = await res.json();
		// PC3-04: 409 tanpa kode khusus = status tiket berubah karena tindakan lain → UI muat ulang, bukan error merah.
		const code = data?.code ?? (res.status === 409 ? 'state_changed' : null);
		return new PettyCashApiError(data?.message || `Gagal (${res.status})`, res.status, code, data?.record);
	} catch {
		return new PettyCashApiError(`Gagal (${res.status})`, res.status, res.status === 409 ? 'state_changed' : null);
	}
}

/** Batas kirim dari HP; lebih besar dari ini dan tak bisa diperkecil → tolak dengan pesan ramah (bukan 413 mentah). */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Perkecil foto nota (target ≤ ~500 KB). Worker gagal (memori HP murah) → coba tanpa worker →
 * bila tetap gagal: kirim asli hanya bila ≤ MAX_UPLOAD_BYTES, selain itu lempar photo_too_large.
 */
export async function compressPhoto(file: File): Promise<File> {
	try {
		return await imageCompression(file, { maxSizeMB: 0.5, maxWidthOrHeight: 1600, useWebWorker: true, initialQuality: 0.8 });
	} catch (e) {
		console.warn('Kompres foto (worker) gagal, coba tanpa worker:', e);
		try {
			return await imageCompression(file, { maxSizeMB: 0.5, maxWidthOrHeight: 1280, useWebWorker: false });
		} catch (e2) {
			console.warn('Kompres foto gagal total:', e2);
			if (file.size > MAX_UPLOAD_BYTES) {
				throw new PettyCashApiError(
					'Foto terlalu besar dan tidak bisa diperkecil di HP ini. Coba foto ulang dengan kamera biasa (bukan mode HDR/ultra), atau kirim tanpa foto dan serahkan nota fisik ke kasir.',
					413,
					'photo_too_large'
				);
			}
			return file;
		}
	}
}

/** Daftar dana kas kecil aktif ber-kasir saja (untuk form PA "Petty Cash" — PC3-08). */
export async function getPettyCashFunds(): Promise<PettyCashFund[]> {
	const idToken = await getIdToken();
	const res = await tfetch('/api/ess/petty-cash?only=funds', { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw await parseError(res);
	const data = await res.json();
	return data?.funds || [];
}

/** Hitungan dari server (PC3-12): benar walau daftar terpotong. `truncated:false` → hitung dari array seperti biasa. */
export interface PettyCashListMeta {
	total: number;
	truncated: boolean;
	pinned?: number;
	sum_amount?: number;
	pending_review?: number;
	cair?: number;
	perlu_lpj?: number;
}

export async function getPettyCashData(limit = 30): Promise<{
	requests: PettyCashRequestRecord[];
	atasan: PettyCashRequestRecord[];
	funds: PettyCashFund[];
	meta?: PettyCashListMeta;
}> {
	const idToken = await getIdToken();
	const res = await tfetch(`/api/ess/petty-cash?limit=${limit}`, { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw await parseError(res);
	return res.json();
}

export interface InventoryItemOption {
	id: number;
	nama_barang_lengkap: string;
	kode_item?: string | null;
	satuan?: string | null;
}

export interface GudangOption {
	id: number;
	kode_gudang?: string | null;
	nama_gudang: string;
	jenis?: string | null;
}

export interface AjukanPettyCashParams {
	mode: 'reimburse' | 'advance';
	fund_id: number;
	amount: number;
	description: string;
	payee_name?: string;
	receipt_number?: string;
	needed_date?: string;
	buktiFile?: File | null;
	/** FLD-04: kirim lagi walau server mendeteksi tiket identik yang baru tersimpan. */
	allowDuplicate?: boolean;
	/** PC3-19: kunci idempoten per pengisian form (dibuat saat form dibuka, disimpan di draf) */
	clientTxnId?: string;
	/** Fase 2/F1 lanjutan "Gate Disiplin Lapangan" (6 Okt 2026) — dasar G_PC_VISIT/
	 *  G_P2H_ALAT_BBM_PC/jatah darurat. Semua opsional, kosong = N/A (perilaku lama). */
	siteCheckinId?: string | null;
	visitException?: string | null;
	equipmentRefId?: string | null;
	literBbm?: number | null;
	/** Interlocking Kas Kecil Fase 3 (13 Okt 2026): klaim BBM kendaraan wajib KM + tanggal nota (server menolak bila kendaraan tanpa keduanya). */
	vehicleRefId?: number | null;
	odometerKm?: number | null;
	hmAlat?: number | null;
	receiptDate?: string | null;
	/** PRJ-21: proyek yang menanggung biaya ini (opsional). Terisi → Kasir memposting ke biaya proyek (RAP vs Aktual). */
	projectId?: number | null;
	/** Integrasi Kas Kecil Pembelian Stok Persediaan (Cash Purchase / Stock-IN) */
	isInventoryIn?: boolean;
	inventoryItemId?: number | null;
	inventoryQty?: number | null;
	gudangId?: number | null;
}

function buildRequestForm(params: AjukanPettyCashParams) {
	const fd = new FormData();
	fd.append('mode', params.mode);
	fd.append('fund_id', String(params.fund_id));
	fd.append('amount', String(params.amount));
	fd.append('description', params.description);
	if (params.payee_name) fd.append('payee_name', params.payee_name);
	if (params.receipt_number) fd.append('receipt_number', params.receipt_number);
	if (params.needed_date) fd.append('needed_date', params.needed_date);
	if (params.allowDuplicate) fd.append('allow_duplicate', '1');
	if (params.clientTxnId) fd.append('client_txn_id', params.clientTxnId);
	if (params.siteCheckinId) fd.append('site_checkin_id', params.siteCheckinId);
	if (params.visitException) fd.append('visit_exception', params.visitException);
	if (params.equipmentRefId) fd.append('equipment_ref_id', params.equipmentRefId);
	if (params.literBbm != null) fd.append('liter_bbm', String(params.literBbm));
	if (params.vehicleRefId) fd.append('vehicle_ref_id', String(params.vehicleRefId));
	if (params.odometerKm != null) fd.append('odometer_km', String(params.odometerKm));
	if (params.hmAlat != null) fd.append('hm_alat', String(params.hmAlat));
	if (params.receiptDate) fd.append('receipt_date', params.receiptDate);
	if (params.projectId) fd.append('project_id', String(params.projectId));
	if (params.isInventoryIn) fd.append('is_inventory_in', '1');
	if (params.inventoryItemId) fd.append('inventory_item_id', String(params.inventoryItemId));
	if (params.inventoryQty != null) fd.append('inventory_qty', String(params.inventoryQty));
	if (params.gudangId) fd.append('gudang_id', String(params.gudangId));
	return fd;
}

/** Pencarian katalog identitas_barang untuk pembelian stok kas kecil (min 2 huruf). */
export async function searchInventoryItems(query: string): Promise<InventoryItemOption[]> {
	if (!query || query.trim().length < 2) return [];
	const idToken = await getIdToken();
	const res = await tfetch(`/api/ess/petty-cash/inventory-options?q=${encodeURIComponent(query.trim())}`, {
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) return [];
	const data = await res.json().catch(() => ({}));
	return data?.items || [];
}

/** Memuat daftar gudang aktif untuk tujuan Stock-IN Kas Kecil. */
export async function getInventoryWarehouses(): Promise<GudangOption[]> {
	const idToken = await getIdToken();
	const res = await tfetch('/api/ess/petty-cash/inventory-options?warehouses=1', {
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) return [];
	const data = await res.json().catch(() => ({}));
	return data?.warehouses || [];
}

async function appendPhoto(fd: FormData, file?: File | null) {
	if (!file) return;
	const c = await compressPhoto(file);
	fd.append('bukti', c, c.name || 'nota.jpg');
}

export async function ajukanPettyCash(
	params: AjukanPettyCashParams
): Promise<{ record: PettyCashRequestRecord; status: string }> {
	const idToken = await getIdToken();
	const fd = buildRequestForm(params);
	await appendPhoto(fd, params.buktiFile);
	const res = await tfetch('/api/ess/petty-cash', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` },
		body: fd
	}, UPLOAD_TIMEOUT_MS);
	if (!res.ok) throw await parseError(res);
	return res.json();
}

/**
 * FLD-01 — perbaiki tiket "Perlu Revisi" lalu kirim ulang (nomor PCR tetap).
 * Foto baru opsional: kosong = foto lama tetap terlampir.
 */
export async function perbaikiPettyCash(
	id: number,
	params: AjukanPettyCashParams
): Promise<{ record: PettyCashRequestRecord; status: string }> {
	const idToken = await getIdToken();
	const fd = buildRequestForm(params);
	await appendPhoto(fd, params.buktiFile);
	const res = await tfetch(`/api/ess/petty-cash/${id}`, {
		method: 'PUT',
		headers: { Authorization: `Bearer ${idToken}` },
		body: fd
	}, UPLOAD_TIMEOUT_MS);
	if (!res.ok) throw await parseError(res);
	return res.json();
}

async function act(id: number, payload: Record<string, unknown>): Promise<void> {
	const idToken = await getIdToken();
	const res = await tfetch(`/api/ess/petty-cash/${id}`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	});
	if (!res.ok) throw await parseError(res);
}

export const batalkanPettyCash = (id: number) => act(id, { action: 'cancel' });
/**
 * PC3-14 — kirim LPJ uang muka: nominal + foto nota (maks 5, dikompres seperti form pengajuan) sebagai multipart.
 * Respons 422 `LPJ_OUTLIER` (nominal tak wajar) → UI meminta konfirmasi lalu kirim ulang dengan confirmOutlier.
 */
export async function kirimLpjPettyCash(
	id: number,
	opts: { amount: number; files?: File[]; confirmOutlier?: boolean; overageReason?: string }
): Promise<void> {
	const idToken = await getIdToken();
	const fd = new FormData();
	fd.append('action', 'lpj');
	fd.append('settlement_amount', String(opts.amount));
	if (opts.confirmOutlier) fd.append('confirm_outlier', '1');
	if (opts.overageReason?.trim()) fd.append('overage_reason', opts.overageReason.trim());
	for (const f of (opts.files || []).slice(0, 5)) {
		const c = await compressPhoto(f);
		fd.append('bukti', c, c.name || 'nota.jpg');
	}
	const res = await tfetch(`/api/ess/petty-cash/${id}`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` },
		body: fd
	}, UPLOAD_TIMEOUT_MS);
	if (!res.ok) throw await parseError(res);
}

// F13 (Fase 3 Petty Cash ESS v2) — atasan approve/tolak/revisi dari HP.
export const atasanApprovePettyCash = (id: number) => act(id, { action: 'atasan_approve' });
export const atasanRejectPettyCash = (id: number, note: string) => act(id, { action: 'atasan_reject', note });
export const atasanRevisiPettyCash = (id: number, note: string) => act(id, { action: 'atasan_revisi', note });

/** U7 — riwayat tiket (linimasa) — dimuat hanya saat diminta. */
export async function getPettyCashHistory(id: number): Promise<any[]> {
	const idToken = await getIdToken();
	const res = await tfetch(`/api/ess/petty-cash/${id}`, { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw await parseError(res);
	const data = await res.json();
	return data?.logs || [];
}

/** U2 — foto nota lewat route server berhak-akses; hasil berupa blob URL (dimuat lazy saat "Lihat nota"). */
export async function fetchNotaObjectUrl(id: number, fileId: string): Promise<string> {
	const idToken = await getIdToken();
	const res = await tfetch(`/api/ess/petty-cash/${id}/bukti/${encodeURIComponent(fileId)}`, { headers: { Authorization: `Bearer ${idToken}` } }, UPLOAD_TIMEOUT_MS);
	if (!res.ok) throw await parseError(res);
	return URL.createObjectURL(await res.blob());
}
