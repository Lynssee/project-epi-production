// src/lib/services/salesSampleRequest.ts
// Klien untuk modul Request Sample Cat (SI-TAMA Sales §7). Semua panggilan lewat
// endpoint SvelteKit /api/sales/sample-request (token Directus di server), auth
// Firebase ID token.

import { auth } from '$lib/firebase';

export type SampleStatus =
	| 'draft'
	| 'menunggu_approval'
	| 'disetujui'
	| 'dalam_proses'
	| 'terkirim'
	| 'selesai'
	| 'ditolak';

export interface SampleRequestRow {
	id: number;
	nomor_request: string | null;
	tanggal: string | null;
	status: SampleStatus;
	sales_id: { id: number; nama_karyawan: string } | number | null;
	customer_id: { id: number; nama_sj_fp: string; kode_customer?: string } | number | null;
	customer_name: string | null;
	prospect_id: number | null;
	produk_cat: string | null;
	warna: string | null;
	ukuran_sample: string | null;
	jumlah: number | null;
	tujuan: string | null;
	kategori: string | null;
	keterangan: string | null;
	approved_by: { id: number; nama_karyawan: string } | number | null;
	approved_at: string | null;
	catatan_approver: string | null;
	tanggal_kirim: string | null;
	foto_bukti: string | null;
	date_created?: string | null;
	// Fase 6.3 (rencana lifecycle produksi v2, 15 Sep 2026)
	sumber_pemenuhan?: 'stok_fg' | 'trial_lab' | 'spk_sample' | null;
	feedback_hasil?: 'diterima' | 'revisi' | 'ditolak' | null;
	feedback_catatan?: string | null;
}

export const FEEDBACK_HASIL_LABELS: Record<string, string> = {
	diterima: 'Diterima',
	revisi: 'Revisi',
	ditolak: 'Ditolak'
};

export const SAMPLE_STATUS_LABELS: Record<SampleStatus, string> = {
	draft: 'Draft',
	menunggu_approval: 'Menunggu Approval',
	disetujui: 'Disetujui',
	dalam_proses: 'Dalam Proses',
	terkirim: 'Terkirim',
	selesai: 'Selesai',
	ditolak: 'Ditolak'
};

export const UKURAN_SAMPLE_OPTIONS = [
	{ value: '100ml', label: '100 ml' },
	{ value: '250ml', label: '250 ml' },
	{ value: '500ml', label: '500 ml' },
	{ value: '1L', label: '1 Liter' }
];

export const TUJUAN_SAMPLE_OPTIONS = [
	{ value: 'demo_presentasi', label: 'Demo / Presentasi' },
	{ value: 'uji_lapangan', label: 'Uji Lapangan' },
	{ value: 'matching_warna', label: 'Matching Warna' },
	{ value: 'lainnya', label: 'Lainnya' }
];

// Kategori bentuk sample — dipakai R&D/gudang untuk menyiapkan & triase permintaan.
// Sinkron dengan enum kolom `sales_sample_request.kategori` di Directus.
export const KATEGORI_SAMPLE_OPTIONS = [
	{ value: 'plat_kering', label: 'Sample Plat Kering' },
	{ value: 'tarikan_warna', label: 'Tarikan Warna' },
	{ value: 'aplikasi_substrat', label: 'Aplikasi ke Substrat' },
	{ value: 'uji_daya_tutup', label: 'Uji Daya Tutup' },
	{ value: 'panel_pajangan', label: 'Panel Pajangan / Display' },
	{ value: 'matching_existing', label: 'Matching Existing' },
	{ value: 'lainnya', label: 'Lainnya' }
];

export const kategoriSampleLabel = (v: string | null | undefined): string =>
	KATEGORI_SAMPLE_OPTIONS.find((o) => o.value === v)?.label || '';

async function authHeaders(): Promise<Record<string, string>> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi login tidak ditemukan. Muat ulang halaman.');
	return { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` };
}

async function handle(res: Response) {
	if (!res.ok) {
		const msg = (await res.json().catch(() => ({})))?.message || `Gagal (${res.status})`;
		throw new Error(msg);
	}
	return (await res.json())?.data;
}

export interface ListSampleFilter {
	status?: string;
	mine?: boolean;
	q?: string;
	from?: string;
	to?: string;
}

export async function listSampleRequests(filter: ListSampleFilter = {}): Promise<SampleRequestRow[]> {
	const sp = new URLSearchParams();
	if (filter.status && filter.status !== 'all') sp.set('status', filter.status);
	if (filter.mine) sp.set('mine', '1');
	if (filter.q) sp.set('q', filter.q);
	if (filter.from) sp.set('from', filter.from);
	if (filter.to) sp.set('to', filter.to);
	const res = await fetch(`/api/sales/sample-request?${sp.toString()}`, { headers: await authHeaders() });
	return (await handle(res)) || [];
}

export async function getSampleRequest(id: number): Promise<SampleRequestRow> {
	const res = await fetch(`/api/sales/sample-request/${id}`, { headers: await authHeaders() });
	return handle(res);
}

export interface CreateSamplePayload {
	client_txn_id?: string;
	tanggal?: string;
	customer_id?: number | null;
	customer_name?: string | null;
	prospect_id?: number | null;
	produk_cat: string;
	warna: string;
	ukuran_sample?: string;
	jumlah?: number;
	tujuan?: string;
	kategori?: string | null;
	keterangan?: string;
	submit?: boolean;
}

export async function createSampleRequest(payload: CreateSamplePayload): Promise<SampleRequestRow> {
	const res = await fetch('/api/sales/sample-request', {
		method: 'POST',
		headers: await authHeaders(),
		body: JSON.stringify(payload)
	});
	return handle(res);
}

type SampleAction = 'submit' | 'edit' | 'approve' | 'reject' | 'mark_process' | 'mark_sent' | 'mark_done' | 'feedback';

export async function patchSampleRequest(
	id: number,
	action: SampleAction,
	extra: Record<string, any> = {}
): Promise<SampleRequestRow> {
	const res = await fetch(`/api/sales/sample-request/${id}`, {
		method: 'PATCH',
		headers: await authHeaders(),
		body: JSON.stringify({ action, ...extra })
	});
	return handle(res);
}

export function sampleStatusStyle(status: SampleStatus): string {
	switch (status) {
		case 'selesai':
			return 'background:var(--gg); color:var(--ggd)';
		case 'ditolak':
			return 'background:var(--rel); color:var(--red)';
		case 'menunggu_approval':
			return 'background:var(--aml); color:var(--amd)';
		case 'disetujui':
		case 'dalam_proses':
			return 'background:#DBEAFE; color:#1D4ED8';
		case 'terkirim':
			return 'background:#EDE9FE; color:#6D28D9';
		default:
			return 'background:var(--sys-fill); color:var(--sys-label3)';
	}
}
