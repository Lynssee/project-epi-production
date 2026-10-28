// src/routes/api/inventory-proyek/direct-purchase/+server.ts
// Pencatatan Pembelian Langsung Material/Alat di Site (IN-PURCHASE) dari Lapangan.
// Keputusan User: Tidak wajib leader dan verifikasi admin proyek (langsung masuk ke saldo fisik site).
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { appendLedgerEntry, rebuildProjectStockBalance, TRANSACTION_TYPES } from '$lib/server/projectLedger';
import { directusServerJson } from '$lib/server/directus';

export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => ({}));
	const {
		projectId,
		itemId,
		quantity,
		unitPrice = 0,
		referenceNo,
		notes,
		submittedBy = null,
		clientTxnId
	} = body;

	const pId = Number(projectId);
	const iId = Number(itemId);
	const qty = Number(quantity);
	const price = Number(unitPrice) || 0;

	if (!Number.isFinite(pId) || pId <= 0) throw error(400, 'projectId tidak valid');
	if (!Number.isFinite(iId) || iId <= 0) throw error(400, 'itemId wajib diisi (katalog barang master)');
	if (!Number.isFinite(qty) || qty <= 0) throw error(400, 'quantity wajib angka positif (> 0)');

	const txnId = clientTxnId || `direct-purchase-field-${pId}-${iId}-${Date.now()}`;
	const refNo = referenceNo ? String(referenceNo).trim() : `PURCHASE-SITE-${Date.now()}`;

	// 1. Ambil detail master item dari Directus untuk nama & satuan
	let masterItem: any = null;
	try {
		const itemRes = await directusServerJson<{ data: any }>(
			`/items/identitas_barang/${iId}?fields=id,nama_barang_lengkap,satuan,is_borrowable,consumable,harga_beli,avg_cost`
		);
		masterItem = itemRes?.data;
	} catch (err: any) {
		console.warn('[direct-purchase field] Gagal fetch master item:', err?.message || err);
	}

	const effectiveUnitPrice = price > 0
		? price
		: (Number(masterItem?.avg_cost) || Number(masterItem?.harga_beli) || 0);

	// 2. Tulis transaksi IN-PURCHASE ke buku besar project_stock_ledger
	let ledgerResult: any = null;
	try {
		ledgerResult = await appendLedgerEntry({
			projectId: pId,
			itemId: iId,
			transactionType: TRANSACTION_TYPES.IN_PURCHASE,
			quantity: Math.abs(qty),
			unitPrice: effectiveUnitPrice,
			referenceType: 'site_purchase',
			referenceId: null,
			referenceNo: refNo,
			evidencePhoto: body?.evidencePhoto || null,
			evidenceGps: body?.evidenceGps || null,
			submittedBy: submittedBy ? Number(submittedBy) : null,
			clientTxnId: txnId
		});
	} catch (ledgerErr: any) {
		console.error('[direct-purchase field] Gagal tulis project_stock_ledger:', ledgerErr);
		throw error(500, `Gagal mencatat transaksi buku besar: ${ledgerErr?.message || ledgerErr}`);
	}

	// 3. Rebuild balance secara asinkron agar saldo fisik site ter-update seketika
	if (ledgerResult?.entry && !ledgerResult.deduped) {
		rebuildProjectStockBalance({ projectId: pId }).catch((err) => {
			console.error('[direct-purchase field] Gagal auto-rebuild balance:', err);
		});
	}

	// 4. Catat ke project_expenses (Realisasi Biaya Lapangan) bila bukan alat pinjaman
	let expenseId: number | null = null;
	if (!masterItem?.is_borrowable && effectiveUnitPrice > 0) {
		try {
			const expRes = await directusServerJson<{ data: { id: number } }>('/items/project_expenses', {
				method: 'POST',
				body: JSON.stringify({
					project_id: pId,
					identitas_barang_id: iId,
					material_name: masterItem?.nama_barang_lengkap || 'Material Beli Lokal',
					qty: qty,
					unit: masterItem?.satuan || 'pcs',
					unit_price: effectiveUnitPrice,
					expense_amount: qty * effectiveUnitPrice,
					expense_type: masterItem?.consumable ? 'consumable' : 'operasional',
					expense_date: new Date().toISOString().split('T')[0],
					reference_number: refNo,
					description: notes ? `Beli langsung di site: ${notes}` : 'Pembelian langsung / kasbon di site',
					is_received: 1,
					source: 'site_direct_purchase'
				})
			});
			expenseId = expRes?.data?.id ?? null;
		} catch (expErr: any) {
			console.warn('[direct-purchase field] Non-fatal: Gagal catat project_expenses:', expErr?.message || expErr);
		}
	}

	return json({
		success: true,
		deduped: ledgerResult?.deduped || false,
		ledgerEntryId: ledgerResult?.entry?.id,
		expenseId,
		message: `Penerimaan pembelian lokal ${qty} ${masterItem?.satuan || 'pcs'} berhasil dicatat ke saldo site.`
	});
};
