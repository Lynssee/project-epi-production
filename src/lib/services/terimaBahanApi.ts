// src/lib/services/terimaBahanApi.ts
// Fase 3 (12 Okt 2026): klien tipis untuk /api/produksi/terima-bahan (terima bahan baku SPK + usulan retur).
import { getIdToken } from './secureDirectus';

export interface LotRow {
	item_id: number | null;
	nama: string;
	lot?: string;
	drum?: string;
	qty_actual_kg?: number | null;
	note?: string;
}

export interface ReturnRow {
	item_id: number | null;
	nama: string;
	qty_kg: number;
	note?: string;
}

export interface SpkBahan {
	id: number;
	nomor: string;
	status: string;
	jumlah_produksi: string | number | null;
	unit: string | null;
	total_kg: number | null;
	production_deadline: string | null;
	material_pick_status: 'picking' | 'ready' | 'handed_over' | null;
	material_ready_at: string | null;
	material_handover_at: string | null;
	material_picked_by: string | null;
	material_received_by: string | null;
	material_received_karyawan_id: number | null;
	material_lot_data: LotRow[];
	material_handover_note: string | null;
	material_receipt_note: string | null;
	/** Bahan yang terpotong untuk SPK ini (batas retur). null = ledger gagal dibaca; [] = belum ada/bukan handed_over. */
	retur_bahan: Array<{ item_id: number; nama: string; maks_kg: number }> | null;
	material_return_status: 'diajukan' | 'diterima_gudang' | 'ditolak' | null;
	material_return_data: ReturnRow[] | null;
	material_return_at: string | null;
}

async function authedFetch(init: RequestInit = {}): Promise<any> {
	const token = await getIdToken();
	const res = await fetch('/api/produksi/terima-bahan', {
		...init,
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(body?.message || `Gagal (${res.status})`);
	return body;
}

export async function fetchSpkBahan(): Promise<SpkBahan[]> {
	return (await authedFetch()).spk || [];
}

export async function terimaBahan(spkId: number, note?: string): Promise<SpkBahan> {
	return (await authedFetch({ method: 'POST', body: JSON.stringify({ spkId, action: 'receive', note }) })).spk;
}

export async function ajukanReturBahan(spkId: number, rows: ReturnRow[]): Promise<SpkBahan> {
	return (await authedFetch({ method: 'POST', body: JSON.stringify({ spkId, action: 'return', rows }) })).spk;
}
