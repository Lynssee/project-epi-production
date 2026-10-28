// src/lib/services/projectLossClaimApi.ts
// Fase 3, Rencana v2 "Lifecycle Pengembalian Barang" — klien untuk /api/inventory-proyek/kerugian
// (OUT-LOSS, endpoint sudah ada sejak Fase 6 "Alur Pembelian/Keluar/Masuk v2" tapi belum pernah
// punya pemanggil dari UI). Pola authedFetch sama dengan projectUsageLedger.ts.
import { getIdToken } from './secureDirectus';

export interface LossClaimResult {
	written: boolean;
	deduped?: boolean;
	entryId?: number;
	note?: string;
}

/**
 * Laporkan barang hilang/rusak di proyek (OUT-LOSS ke project_stock_ledger). Wajib foto bukti
 * (evidencePhoto = id file Directus, lihat uploadEvidencePhoto di stockLapangan.ts).
 */
export async function reportLossClaim(params: {
	projectId: number;
	identitasBarangId: number;
	quantity: number;
	evidencePhoto: string;
	rabBudgetId?: number | null;
	batchId: string;
}): Promise<LossClaimResult> {
	const token = await getIdToken();
	const res = await fetch('/api/inventory-proyek/kerugian', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: JSON.stringify(params)
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(err?.message || 'Gagal melaporkan barang hilang/rusak.');
	}
	return res.json();
}
