// src/routes/api/inventory-proyek/retur/+server.ts
// Fase 6 (Rencana Alur Pembelian/Keluar/Masuk v2, item 2): OUT-RETURN -- barang sisa proyek
// dikembalikan fisik ke gudang pusat. TRANSACTION_TYPES.OUT_RETURN sudah didefinisikan di
// projectLedger.ts sejak awal tapi TIDAK PERNAH ADA PEMANGGIL di seluruh repo -- endpoint ini
// menutup gap itu. Pola sama dengan usage/+server.ts (leader proyek, pilot-only, idempoten).
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateProjectLeader } from '$lib/server/goodsReceived/guard';
import { appendLedgerEntry, rebuildProjectStockBalance, TRANSACTION_TYPES } from '$lib/server/projectLedger';
import { resolvePilotProjectIds, isPilotProject } from '$lib/server/inventorySettings';

export const POST: RequestHandler = async (event) => {
	const { karyawan, projectIds } = await authenticateProjectLeader(event);

	const body = await event.request.json().catch(() => null);
	const projectId = Number(body?.projectId);
	const itemId = Number(body?.identitasBarangId);
	const quantity = Number(body?.quantity);
	const projectBudgetId = body?.rabBudgetId || null;
	// project_stock_ledger tidak punya kolom notes (lihat schema di projectLedger.ts) --
	// alasan retur disimpan di reference_no/evidence_photo, bukan teks bebas.
	const evidencePhoto = body?.evidencePhoto || null;
	const batchId = String(body?.batchId || '');

	if (!Number.isFinite(projectId)) throw error(400, 'projectId tidak valid.');
	if (!projectIds.includes(projectId)) throw error(403, 'Anda bukan leader proyek ini.');
	if (!itemId) throw error(400, 'identitasBarangId wajib diisi.');
	if (!Number.isFinite(quantity) || quantity <= 0) throw error(400, 'quantity wajib > 0.');
	if (!batchId) throw error(400, 'batchId wajib diisi (kunci idempotensi).');

	const pilotIds = await resolvePilotProjectIds();
	if (!isPilotProject(pilotIds, projectId)) {
		return json({ written: false, note: 'Proyek bukan pilot, ledger tidak ditulis.' });
	}

	const { entry, deduped } = await appendLedgerEntry({
		projectId,
		itemId,
		projectBudgetId,
		transactionType: TRANSACTION_TYPES.OUT_RETURN,
		quantity: -Math.abs(quantity), // OUT-RETURN selalu negatif (Bab 7.4)
		referenceType: 'retur_gudang',
		referenceNo: `RTN-${batchId}`,
		evidencePhoto,
		submittedBy: karyawan.id,
		clientTxnId: `retur-${batchId}-item-${itemId}`
	});

	if (entry && !deduped) {
		rebuildProjectStockBalance({ projectId }).catch((err) => {
			console.error('[inventory-proyek/retur] Gagal auto-rebuild balance:', err);
		});
	}

	return json({ written: true, deduped, entryId: entry?.id });
};
