// src/lib/services/projectTransferApi.ts
// Fase 3, Rencana v2 "Lifecycle Pengembalian Barang" — klien untuk /api/inventory-proyek/transfer
// (TRANSFER-OUT/TRANSFER-IN). Pola authedFetch sama dengan projectUsageLedger.ts.
import { getIdToken } from './secureDirectus';

export interface TransferResult {
	written: boolean;
	outEntryId?: number;
	inEntryId?: number;
	deduped?: boolean;
	note?: string;
}

/** Pindahkan saldo barang dari proyek asal (milik leader yang login) ke proyek tujuan aktif mana pun. */
export async function transferProjectStock(params: {
	sourceProjectId: number;
	destProjectId: number;
	identitasBarangId: number;
	quantity: number;
	batchId: string;
}): Promise<TransferResult> {
	const token = await getIdToken();
	const res = await fetch('/api/inventory-proyek/transfer', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: JSON.stringify(params)
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(err?.message || 'Gagal memindahkan saldo barang ke proyek tujuan.');
	}
	return res.json();
}
