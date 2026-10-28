// src/lib/services/sjManualApi.ts
// Service tipis Fase 3 — Surat Jalan Manual dari lapangan. Semua panggilan lewat
// endpoint /api/sj-manual/* milik project-epi sendiri (bukan langsung ke Directus),
// dengan Authorization: Bearer <Firebase ID token>. Pola sama dengan sjiApi.ts.

import { getIdToken } from './secureDirectus';

async function authedFetch(path: string, options: RequestInit = {}): Promise<Response> {
	const token = await getIdToken();
	const { headers = {}, ...rest } = options;
	return fetch(path, {
		...rest,
		headers: { ...headers, Authorization: `Bearer ${token}` }
	});
}

async function asJson<T>(res: Response): Promise<T> {
	const data = await res.json().catch(() => null);
	if (!res.ok) throw new Error((data as any)?.message || `HTTP ${res.status}`);
	return data as T;
}

export interface SjManualMeta {
	enabled: boolean;
	requireScanUpload: boolean;
	canSubmit: boolean;
	projects: { id: number; name: string; lokasi: string | null }[];
}

export async function fetchSjManualMeta(): Promise<SjManualMeta> {
	const res = await authedFetch('/api/sj-manual?meta=1');
	return asJson<SjManualMeta>(res);
}

export interface SjManualSearchItem {
	id: number;
	nama_barang_lengkap: string;
	satuan: string | null;
	stok_tersedia: string;
}

export async function searchSjManualItems(query: string): Promise<SjManualSearchItem[]> {
	if (query.trim().length < 2) return [];
	const res = await authedFetch(`/api/sj-manual?search=${encodeURIComponent(query)}`);
	const data = await asJson<{ data: SjManualSearchItem[] }>(res);
	return data.data;
}

export interface SjManualListItem {
	id: number;
	nomor_sj: string;
	status: string;
	approval_status: string;
	manual_customer_name: string | null;
	project_id: { name: string } | null;
	date_created: string;
}

export async function fetchMySjManual(): Promise<SjManualListItem[]> {
	const res = await authedFetch('/api/sj-manual');
	const data = await asJson<{ data: SjManualListItem[] }>(res);
	return data.data;
}

export interface SjManualItemInput {
	itemId?: number | null;
	namaBarang: string;
	qty: number;
	satuan?: string;
	notes?: string;
}

export interface SjManualSubmitPayload {
	customerName: string;
	customerAddress: string;
	customerPhone?: string;
	projectId?: number | null;
	driverName?: string;
	notes?: string;
	items: SjManualItemInput[];
	scanFile?: File | null;
	fotoFile?: File | null;
}

function buildSjManualForm(payload: SjManualSubmitPayload): FormData {
	const { scanFile, fotoFile, ...rest } = payload;
	const form = new FormData();
	form.append('payload', JSON.stringify(rest));
	if (scanFile) form.append('scanFile', scanFile);
	if (fotoFile) form.append('fotoFile', fotoFile);
	return form;
}

export async function createSjManual(
	payload: SjManualSubmitPayload
): Promise<{ success: true; id: number; nomor_sj: string; qr_token: string }> {
	const res = await authedFetch('/api/sj-manual', { method: 'POST', body: buildSjManualForm(payload) });
	return asJson(res);
}

export async function fetchSjManualDetail(id: number) {
	const res = await authedFetch(`/api/sj-manual/${id}`);
	return asJson<{ header: any; items: any[]; actions: any[] }>(res);
}

export async function cancelSjManual(id: number): Promise<{ success: true }> {
	const res = await authedFetch(`/api/sj-manual/${id}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'cancel' })
	});
	return asJson(res);
}

/** Revisi & ajukan ulang SJ Manual yang ditolak. */
export async function resubmitSjManual(
	id: number,
	payload: SjManualSubmitPayload
): Promise<{ success: true; id: number; nomor_sj: string }> {
	const form = buildSjManualForm(payload);
	form.append('action', 'resubmit');
	const res = await authedFetch(`/api/sj-manual/${id}`, { method: 'PATCH', body: form });
	return asJson(res);
}

export interface SjManualDokumen {
	available: boolean;
	status?: string;
	reference_no: string;
	customerName?: string;
	qrPayload?: string;
}

export async function fetchSjManualDokumen(id: number): Promise<SjManualDokumen> {
	const res = await authedFetch(`/api/sj-manual/${id}/dokumen`);
	return asJson<SjManualDokumen>(res);
}
