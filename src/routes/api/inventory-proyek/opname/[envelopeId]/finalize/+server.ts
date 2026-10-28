// src/routes/api/inventory-proyek/opname/[envelopeId]/finalize/+server.ts
// Fase 2: setelah envelope opname ditandatangani (status 'selesai'), tulis baris ADJ-OPNAME
// pertama ke project_stock_ledger -- ini SECARA HARFIAH "saldo awal" per Bab 5. Dipisah dari
// endpoint sign generik (/api/signature/[envelopeId]/sign) karena endpoint itu dipakai banyak
// modul lain (ESS, dsb) dan tidak boleh tahu soal ledger proyek.
//
// Sumber data SATU-SATUNYA adalah data_snapshot yang tersimpan di envelope saat submit --
// bukan payload baru dari klien -- supaya baris ledger persis sama dengan yang ditandatangani
// leader, tidak bisa diselipi angka lain di antara sign dan finalize.
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateProjectLeader } from '$lib/server/goodsReceived/guard';
import { directusServerJson } from '$lib/server/directus';
import { appendLedgerEntry, rebuildProjectStockBalance, TRANSACTION_TYPES } from '$lib/server/projectLedger';

export const POST: RequestHandler = async (event) => {
	const { karyawan, projectIds } = await authenticateProjectLeader(event);
	const envelopeId = Number(event.params.envelopeId);
	if (!Number.isFinite(envelopeId)) throw error(400, 'envelopeId tidak valid.');

	const envRes = await directusServerJson<{ data: any }>(`/items/signature_envelope/${envelopeId}`);
	const envelope = envRes?.data;
	if (!envelope) throw error(404, 'Envelope tidak ditemukan.');
	if (envelope.modul_asal !== 'inventory_proyek.opname') throw error(400, 'Envelope ini bukan opname inventory proyek.');
	if (envelope.status !== 'selesai') throw error(409, 'Envelope belum selesai ditandatangani.');

	const snapshot = envelope.data_snapshot || {};
	const projectId = snapshot.projectId;
	if (!projectIds.includes(projectId)) throw error(403, 'Anda bukan leader proyek ini.');

	const items: any[] = Array.isArray(snapshot.items) ? snapshot.items : [];
	const written: number[] = [];
	const skipped: Array<{ project_budget_id: number; reason: string }> = [];

	for (const it of items) {
		if (!it.identitas_barang_id) {
			skipped.push({ project_budget_id: it.project_budget_id, reason: 'tidak ada identitas_barang_id' });
			continue;
		}
		if (!Number.isFinite(it.physical_qty) || it.physical_qty === 0) {
			// Opname fisik = 0 itu valid (barang memang habis/tidak ada) tapi ADJ-OPNAME butuh
			// quantity bukan nol (lihat validasi appendLedgerEntry) -- lewati baris nol, tidak error.
			skipped.push({ project_budget_id: it.project_budget_id, reason: 'qty fisik 0, tidak ditulis ke ledger' });
			continue;
		}
		try {
			const { entry } = await appendLedgerEntry({
				projectId,
				itemId: it.identitas_barang_id,
				projectBudgetId: it.project_budget_id || null,
				transactionType: TRANSACTION_TYPES.ADJ_OPNAME,
				quantity: it.physical_qty,
				referenceType: 'opname',
				referenceId: envelopeId,
				referenceNo: `OPNAME-${envelopeId}`,
				submittedBy: karyawan.id,
				clientTxnId: `opname-${envelopeId}-budget-${it.project_budget_id}`
			});
			written.push(entry?.id);
		} catch (e: any) {
			skipped.push({ project_budget_id: it.project_budget_id, reason: e?.message || 'gagal tulis ledger' });
		}
	}

	if (written.length > 0) {
		rebuildProjectStockBalance({ projectId }).catch((err) => {
			console.error('[inventory-proyek/opname/finalize] Gagal auto-rebuild balance:', err);
		});
	}

	return json({ written: written.length, skipped });
};
