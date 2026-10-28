// src/lib/services/projectUsageLedger.ts
// Klien untuk menulis OUT-USAGE ke project_stock_ledger dari form pemakaian harian
// (Fase 2, Rencana Implementasi Inventory Proyek v2.0). Dipanggil dari
// routes/(app)/laporan/[project_id]/+page.svelte setelah submitReport/updateReport sukses.

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

export interface UsageLedgerDelta {
	expenseId: number | string;
	identitasBarangId: number | null;
	delta: number;
	rabBudgetId?: number | null;
}

export interface UsageLedgerResult {
	written: number;
	skipped: Array<{ expenseId: string | number; reason: string }>;
	note?: string;
}

/**
 * Kirim delta pemakaian material hasil laporan harian ke ledger. Aman dipanggil untuk proyek
 * mana pun -- server yang memutuskan apakah proyeknya pilot Fase 2 atau bukan (non-pilot
 * mengembalikan written:0 tanpa error).
 */
export async function reportUsageDeltas(
	projectId: number,
	reportId: number | string | null,
	batchId: string,
	deltas: UsageLedgerDelta[]
): Promise<UsageLedgerResult> {
	const validDeltas = deltas.filter((d) => d.identitasBarangId);
	if (!validDeltas.length) return { written: 0, skipped: [] };

	const res = await authedFetch('/api/inventory-proyek/usage', {
		method: 'POST',
		body: JSON.stringify({ projectId, reportId, batchId, deltas: validDeltas })
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(err?.message || 'Gagal mencatat pemakaian ke ledger inventory proyek.');
	}
	return res.json();
}
