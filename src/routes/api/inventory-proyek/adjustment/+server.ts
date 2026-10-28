// src/routes/api/inventory-proyek/adjustment/+server.ts
// Penyesuaian Saldo Fisik / Opname Mandiri Site (ADJ-OPNAME) dari Lapangan.
// Keputusan User: Langsung mencatat ke ledger & update saldo tanpa birokrasi berulang.
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { appendLedgerEntry, rebuildProjectStockBalance, TRANSACTION_TYPES } from '$lib/server/projectLedger';
import { directusServerJson } from '$lib/server/directus';

export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => ({}));
	const {
		projectId,
		itemId,
		physicalQty,
		currentQty = 0,
		delta: inputDelta = null,
		referenceNo,
		notes,
		submittedBy = null,
		clientTxnId
	} = body;

	const pId = Number(projectId);
	const iId = Number(itemId);

	if (!Number.isFinite(pId) || pId <= 0) throw error(400, 'projectId tidak valid');
	if (!Number.isFinite(iId) || iId <= 0) throw error(400, 'itemId wajib diisi');

	// Hitung selisih (delta)
	let delta = 0;
	if (inputDelta !== null && Number.isFinite(Number(inputDelta))) {
		delta = Number(inputDelta);
	} else if (Number.isFinite(Number(physicalQty))) {
		delta = Number(physicalQty) - (Number(currentQty) || 0);
	} else {
		throw error(400, 'physicalQty atau delta wajib diisi');
	}

	if (delta === 0) {
		return json({
			success: true,
			delta: 0,
			message: 'Tidak ada perbedaan kuantitas (delta 0). Saldo tidak berubah.'
		});
	}

	const txnId = clientTxnId || `opname-adj-field-${pId}-${iId}-${Date.now()}`;
	const refNo = referenceNo ? String(referenceNo).trim() : `OPNAME-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

	// Ambil valuasi barang untuk total_value ledger
	let unitPrice = 0;
	try {
		const itemRes = await directusServerJson<{ data: any }>(`/items/identitas_barang/${iId}?fields=avg_cost,harga_beli`);
		unitPrice = Number(itemRes?.data?.avg_cost) || Number(itemRes?.data?.harga_beli) || 0;
	} catch {
		/* fallback unitPrice 0 */
	}

	try {
		const { entry, deduped } = await appendLedgerEntry({
			projectId: pId,
			itemId: iId,
			transactionType: TRANSACTION_TYPES.ADJ_OPNAME,
			quantity: delta, // ADJ_OPNAME bebas tanda (+ atau -)
			unitPrice,
			referenceType: 'stock_opname',
			referenceId: null,
			referenceNo: refNo,
			notes: notes || 'Koreksi penyesuaian fisik / opname site',
			submittedBy: submittedBy ? Number(submittedBy) : null,
			clientTxnId: txnId
		});

		if (entry && !deduped) {
			await rebuildProjectStockBalance({ projectId: pId }).catch((err) => {
				console.error('[adjustment field] Gagal auto-rebuild balance:', err);
			});
		}

		return json({
			success: true,
			deduped,
			ledgerEntryId: entry?.id,
			delta,
			message: `Penyesuaian saldo (${delta > 0 ? '+' : ''}${delta}) berhasil diterapkan ke buku besar.`
		});
	} catch (e: any) {
		console.error('[adjustment field] Gagal simpan penyesuaian opname:', e);
		throw error(500, e?.message || 'Gagal menyimpan penyesuaian stok');
	}
};
