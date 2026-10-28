// src/routes/api/inventory-proyek/transfer/+server.ts
// Fase 3, Rencana v2 "Lifecycle Pengembalian Barang" (25-26 Sep 2026) — TRANSFER-OUT/TRANSFER-IN,
// pindah saldo barang dari proyek asal (milik leader yang login) ke proyek tujuan mana pun
// yang masih aktif. Ditulis sebagai sepasang entri ledger dalam satu request (pola sama
// projectMaterialTransfer.js di erp-epi-1, Fase 2 MLE) -- TIDAK butuh approval leader proyek
// tujuan karena ini murni administratif menyusul perpindahan fisik yang SUDAH terjadi di
// lapangan (leader asal yang bertanggung jawab atas keakuratan laporannya sendiri, sama
// prinsip dengan OUT-LOSS/OUT-USAGE).
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateProjectLeader } from '$lib/server/goodsReceived/guard';
import { appendLedgerEntry, rebuildProjectStockBalance, TRANSACTION_TYPES } from '$lib/server/projectLedger';
import { resolvePilotProjectIds, isPilotProject, getInventorySettingServer } from '$lib/server/inventorySettings';
import { getQtyTerkunciMutasi, saldoTersedia } from '$lib/server/mutasiQtyTerkunci';

/** RSM-13 §4.5: jalur lama (pindah saldo tanpa approval/SJ) dimatikan lewat setelan setelah masa transisi. Default aktif (Aturan #3). */
const JALUR_LAMA_KEY = 'inventory.transfer.jalur_lama_aktif';
import { directusServerJson } from '$lib/server/directus';

export const POST: RequestHandler = async (event) => {
	const { karyawan, projectIds } = await authenticateProjectLeader(event);

	if ((await getInventorySettingServer<boolean>(JALUR_LAMA_KEY, true)) === false) {
		throw error(
			410,
			'Pindah Proyek langsung sudah tidak dipakai. Gunakan menu Mutasi Barang: proyek tujuan menyetujui, lalu barang dikirim dan diterima dengan scan QR.'
		);
	}

	const body = await event.request.json().catch(() => null);
	const sourceProjectId = Number(body?.sourceProjectId);
	const destProjectId = Number(body?.destProjectId);
	const itemId = Number(body?.identitasBarangId);
	const quantity = Number(body?.quantity);
	const batchId = String(body?.batchId || '');

	if (!Number.isFinite(sourceProjectId)) throw error(400, 'sourceProjectId tidak valid.');
	if (!projectIds.includes(sourceProjectId)) throw error(403, 'Anda bukan leader proyek asal.');
	if (!Number.isFinite(destProjectId)) throw error(400, 'destProjectId tidak valid.');
	if (destProjectId === sourceProjectId) throw error(400, 'Proyek tujuan tidak boleh sama dengan proyek asal.');
	if (!itemId) throw error(400, 'identitasBarangId wajib diisi.');
	if (!Number.isFinite(quantity) || quantity <= 0) throw error(400, 'quantity wajib > 0.');
	if (!batchId) throw error(400, 'batchId wajib diisi (kunci idempotensi).');

	// Proyek tujuan wajib aktif -- jangan pindahkan saldo ke proyek yang sudah closed/cancel.
	const destCheck = await directusServerJson<{ data: Array<{ id: number; status: string }> }>(
		`/items/projects?filter[id][_eq]=${destProjectId}&fields=id,status&limit=1`
	);
	const destProject = destCheck?.data?.[0];
	if (!destProject) throw error(400, 'Proyek tujuan tidak ditemukan.');
	if (['closed', 'cancel', 'cancelled'].includes(destProject.status)) {
		throw error(400, 'Proyek tujuan sudah closed/cancel, tidak bisa menerima transfer.');
	}

	const pilotIds = await resolvePilotProjectIds();
	if (!isPilotProject(pilotIds, sourceProjectId)) {
		return json({ written: false, note: 'Proyek asal bukan pilot, ledger tidak ditulis.' });
	}

	// RSM-13 §4.0: cek saldo di SERVER (dulu hanya klien: transferQty > qty_on_hand). Pengiriman ulang dengan
	// batchId yang sama (sudah tercatat) dilewati supaya idempotensi tidak gagal karena saldo sudah berkurang.
	const outTxnId = `transfer-${batchId}-out-item-${itemId}`;
	const already = await directusServerJson<{ data: Array<{ id: number }> }>(
		`/items/project_stock_ledger?filter[client_txn_id][_eq]=${encodeURIComponent(outTxnId)}&fields=id&limit=1`
	).then((r) => (r?.data?.length ?? 0) > 0);
	if (!already) {
		const bal = await directusServerJson<{ data: Array<{ qty_on_hand: number }> }>(
			`/items/project_stock_balance?filter[project_id][_eq]=${sourceProjectId}&filter[item_id][_eq]=${itemId}&fields=qty_on_hand&limit=1`
		);
		const onHand = Number(bal?.data?.[0]?.qty_on_hand) || 0;
		// RSM-13 §4.2: qty yang sudah dikunci mutasi (belum berangkat) tidak boleh dipindah lewat jalur lama juga.
		const terkunci = (await getQtyTerkunciMutasi(sourceProjectId)).get(itemId) || 0;
		if (terkunci > 0 && saldoTersedia(onHand, terkunci) < quantity - 0.01) {
			throw error(409, `Sebagian saldo (${terkunci}) sedang dikunci pengajuan Mutasi Barang yang belum berangkat. Tersedia ${saldoTersedia(onHand, terkunci)}, diminta ${quantity}.`);
		}
		if (onHand < quantity - 0.01) {
			throw error(
				409,
				`Saldo barang di proyek asal tidak cukup: tersedia ${onHand}, diminta ${quantity}. ` +
					`Muat ulang Saldo Barang Saya (saldo diperbarui berkala) atau kurangi jumlahnya.`
			);
		}
	}

	const outEntry = await appendLedgerEntry({
		projectId: sourceProjectId,
		itemId,
		transactionType: TRANSACTION_TYPES.TRANSFER_OUT,
		quantity: -Math.abs(quantity),
		referenceType: 'project_transfer',
		referenceId: destProjectId,
		referenceNo: `TRF-${batchId}`,
		submittedBy: karyawan.id,
		clientTxnId: `transfer-${batchId}-out-item-${itemId}`
	});

	const inEntry = await appendLedgerEntry({
		projectId: destProjectId,
		itemId,
		transactionType: TRANSACTION_TYPES.TRANSFER_IN,
		quantity: Math.abs(quantity),
		referenceType: 'project_transfer',
		referenceId: sourceProjectId,
		referenceNo: `TRF-${batchId}`,
		submittedBy: karyawan.id,
		clientTxnId: `transfer-${batchId}-in-item-${itemId}`
	});

	if (outEntry.entry && inEntry.entry && (!outEntry.deduped || !inEntry.deduped)) {
		rebuildProjectStockBalance({ projectId: sourceProjectId }).catch((err) => {
			console.error('[inventory-proyek/transfer] Gagal auto-rebuild source project balance:', err);
		});
		rebuildProjectStockBalance({ projectId: destProjectId }).catch((err) => {
			console.error('[inventory-proyek/transfer] Gagal auto-rebuild dest project balance:', err);
		});
	}

	return json({
		written: true,
		outEntryId: outEntry.entry?.id,
		inEntryId: inEntry.entry?.id,
		deduped: outEntry.deduped && inEntry.deduped
	});
};
