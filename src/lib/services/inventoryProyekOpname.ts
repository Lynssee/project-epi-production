// src/lib/services/inventoryProyekOpname.ts
// Klien untuk opname fisik pembuka proyek pilot (Fase 1, Rencana Inventory Proyek v2.0).

import { getIdToken } from './secureDirectus';

async function authedFetch(path: string, options: RequestInit = {}): Promise<Response> {
	const token = await getIdToken();
	const { headers = {}, ...rest } = options;
	return fetch(path, {
		...rest,
		headers: {
			'Content-Type': 'application/json',
			...(headers as Record<string, string>),
			Authorization: `Bearer ${token}`
		}
	});
}

export interface OpnameItem {
	project_budget_id: number;
	identitas_barang_id: number;
	material_name: string;
	unit: string;
	rab_qty: number;
	qty_diterima: number;
}

export async function fetchOpnameItems(projectId: number): Promise<OpnameItem[]> {
	const res = await authedFetch(`/api/inventory-proyek/opname/items?projectId=${projectId}`);
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(err?.message || 'Gagal memuat daftar item opname.');
	}
	const data = await res.json();
	return data.items || [];
}

export interface OpnameSubmitItem {
	project_budget_id: number;
	identitas_barang_id: number;
	material_name: string;
	unit: string;
	rab_qty: number;
	physical_qty: number;
	notes?: string;
}

export async function submitOpname(
	projectId: number,
	items: OpnameSubmitItem[]
): Promise<{ envelopeId: number }> {
	const res = await authedFetch('/api/inventory-proyek/opname', {
		method: 'POST',
		body: JSON.stringify({ projectId, items })
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(err?.message || 'Gagal menyimpan opname.');
	}
	return res.json();
}

export async function signOpname(envelopeId: number, ttdDataUrl: string): Promise<{ status: string }> {
	const res = await authedFetch(`/api/signature/${envelopeId}/sign`, {
		method: 'POST',
		body: JSON.stringify({ ttdDataUrl })
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(err?.message || 'Gagal menandatangani opname.');
	}
	return res.json();
}

/** Tulis baris ADJ-OPNAME pertama ke project_stock_ledger dari envelope yang sudah selesai ditandatangani. */
export async function finalizeOpnameLedger(
	envelopeId: number
): Promise<{ written: number; skipped: Array<{ project_budget_id: number; reason: string }> }> {
	const res = await authedFetch(`/api/inventory-proyek/opname/${envelopeId}/finalize`, { method: 'POST' });
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(err?.message || 'Gagal finalisasi ledger opname.');
	}
	return res.json();
}

export interface OpnameSession {
	id: number;
	status: string;
	judul: string;
	date_created: string;
	data_snapshot: { projectId: number; projectName: string; submittedBy: string; items: any[] };
}

export async function fetchOpnameSessions(): Promise<{ sessions: OpnameSession[]; pilotProjectIds: number[] }> {
	const res = await authedFetch('/api/inventory-proyek/opname');
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(err?.message || 'Gagal memuat riwayat opname.');
	}
	return res.json();
}

// F2 (Rencana Implementasi Inventory arsitektur navigasi v2.0): stok proyek turunan otomatis.
export interface ProjectStockBalanceRow {
	id: number;
	item_id: { id: number; nama_barang_lengkap: string; satuan: string } | null;
	qty_received: number;
	qty_used: number;
	qty_lost: number;
	qty_returned: number;
	qty_on_hand: number;
	rab_qty: number;
	last_movement_date: string | null;
	last_rebuilt_at: string | null;
	status: string;
}

export async function rebuildProjectStockBalance(projectId: number): Promise<{ groupsProcessed: number }> {
	const res = await authedFetch('/api/inventory-proyek/rebuild-balance', {
		method: 'POST',
		body: JSON.stringify({ projectId })
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(err?.message || 'Gagal rebuild stok proyek.');
	}
	return res.json();
}

export async function fetchProjectStockBalance(projectId: number): Promise<ProjectStockBalanceRow[]> {
	const res = await authedFetch(`/api/inventory-proyek/stock-balance?projectId=${projectId}`);
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(err?.message || 'Gagal memuat stok proyek.');
	}
	const data = await res.json();
	return data.rows || [];
}
