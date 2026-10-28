// src/lib/services/pelarutApi.ts
// Pelacak Pelarut Daur Ulang — Tahap A (13 Okt 2026): klien tipis untuk /api/produksi/pelarut.
import { getIdToken } from './secureDirectus';

export interface PelarutItem {
	id: number;
	nama: string;
	satuan: string;
}
export interface SpkOpsi {
	id: number;
	nomor: string;
}
export interface PelarutLog {
	id: number;
	tanggal: string;
	jenis: 'dikumpulkan' | 'dipakai_ulang';
	item_id: number;
	qty_kg: number;
	spk_id: number | null;
	sumber: string | null;
	catatan: string | null;
}
export interface PelarutInput {
	jenis: 'dikumpulkan' | 'dipakai_ulang';
	item_id: number;
	qty_kg: number;
	spk_id?: number | null;
	sumber?: string | null;
	catatan?: string;
}

async function authedFetch(init: RequestInit = {}): Promise<any> {
	const token = await getIdToken();
	const res = await fetch('/api/produksi/pelarut', {
		...init,
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(body?.message || `Gagal (${res.status})`);
	return body;
}

export async function fetchPelarut(): Promise<{ items: PelarutItem[]; spk: SpkOpsi[]; riwayat: PelarutLog[] }> {
	const b = await authedFetch();
	return { items: b.items || [], spk: b.spk || [], riwayat: b.riwayat || [] };
}

export async function catatPelarut(input: PelarutInput): Promise<PelarutLog> {
	return (await authedFetch({ method: 'POST', body: JSON.stringify(input) })).entry;
}
