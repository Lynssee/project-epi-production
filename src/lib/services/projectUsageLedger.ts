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

export interface KomplainLockVerdict {
	mode: 'shadow' | 'soft' | 'warn' | 'hard';
	decision: 'pass' | 'warn' | 'block';
	locks: Array<{ itemId: number; namaBarang: string; logId: number; jenis: string; nomorSj: string | null }>;
	message: string | null;
}

/**
 * Pra-cek gate G_PROYEK_KOMPLAIN_LOCK sebelum laporan harian disimpan: adakah barang yang akan dilaporkan terpakai tetapi sedang
 * dikomplain di proyek ini? Fail-open: gangguan jaringan/server => null (laporan tidak boleh macet karena gate), dicatat di console.
 */
export async function checkKomplainLock(projectId: number, itemIds: number[]): Promise<KomplainLockVerdict | null> {
	const ids = [...new Set(itemIds.filter((n) => Number.isFinite(n) && n > 0))];
	if (!ids.length) return null;
	try {
		const res = await authedFetch('/api/inventory-proyek/komplain-lock', {
			method: 'POST',
			body: JSON.stringify({ projectId, itemIds: ids })
		});
		if (!res.ok) {
			console.warn('[komplain-lock] pra-cek gagal, dilewati:', res.status);
			return null;
		}
		return (await res.json()) as KomplainLockVerdict;
	} catch (e) {
		console.warn('[komplain-lock] pra-cek gagal, dilewati:', e instanceof Error ? e.message : e);
		return null;
	}
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
