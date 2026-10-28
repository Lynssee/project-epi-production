// src/lib/services/rekeningPenerimaApi.ts
// Klien tipis ke /api/rekening-penerima/* — Penajaman Penerima Dana & Track Record v2,
// Fase 4 (11 Sep 2026). Kembaran ringan dari erp-epi rekeningPenerimaApi.js.

import { getIdToken } from '$lib/services/secureDirectus';

export interface RekeningRow {
	id: number;
	bank_kode: string;
	bank_label?: string;
	rekening_mask?: string;
	rekening_norm?: string;
	atas_nama: string | null;
	status_verifikasi: 'belum' | 'terverifikasi' | 'ditolak';
	status: 'aktif' | 'diblokir';
	blokir_alasan?: string | null;
}

async function authedFetch(url: string, opts: RequestInit = {}) {
	const token = await getIdToken();
	return fetch(url, {
		...opts,
		headers: {
			...(opts.headers || {}),
			Authorization: `Bearer ${token}`,
			...(opts.body ? { 'Content-Type': 'application/json' } : {})
		}
	});
}

export async function searchRekeningPenerima(q: string): Promise<{ terdaftar: RekeningRow[]; terakhirSaya: RekeningRow[]; tooShort?: boolean }> {
	const res = await authedFetch(`/api/rekening-penerima/search?q=${encodeURIComponent(q || '')}`);
	if (!res.ok) throw new Error(`Gagal mencari rekening (HTTP ${res.status})`);
	return res.json();
}

export async function selectRekeningTerdaftar(rekeningPenerimaId: number | string): Promise<RekeningRow> {
	const res = await authedFetch('/api/rekening-penerima/register', {
		method: 'POST',
		body: JSON.stringify({ selectRekeningPenerimaId: rekeningPenerimaId })
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(body.message || `Gagal memilih rekening (HTTP ${res.status})`);
	return body.data;
}

export async function registerRekeningBaru(p: { bankNameRaw: string; rekeningRaw: string; atasNama: string }): Promise<RekeningRow> {
	const res = await authedFetch('/api/rekening-penerima/register', {
		method: 'POST',
		body: JSON.stringify(p)
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(body.message || `Gagal mendaftarkan rekening (HTTP ${res.status})`);
	return body.data;
}
