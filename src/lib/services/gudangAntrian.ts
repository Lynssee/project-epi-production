// src/lib/services/gudangAntrian.ts
// Antrian Persiapan — Gudang Pusat Bojongkulur v2 (Fase 1, READ-ONLY).
// Sumber data: koleksi `packing_list` + `packing_list_items` yang SUDAH hidup (44 baris produksi,
// lihat rencana implementasi Bab 2 T5) — TIDAK ada koleksi baru, sesuai keputusan Q0.1 Opsi A.
// Baris packing_list lama belum punya gudang_id terisi, jadi antrian TIDAK memfilter ketat by
// gudang_id — semua packing_list yang masih aktif ditampilkan; gudang_id hanya dipakai untuk
// penugasan eksplisit ke depan (diisi lewat tab admin Gudang Pusat).

import directus, { handleDirectusError } from './directus';
import { readItems, updateItem } from '@directus/sdk';
import { submitGudangPick, submitOpnameAdjustment, type EvidenceParams, type StockMovementResult } from './stockLapangan';
import { loadInventorySettings, getInventorySetting } from './inventorySettings';

const ACTIONABLE_STATUS = ['active', 'approved'];
const DISPATCHED_PREP_STATUS = 'dispatched';

export interface AntrianItemRow {
	id: number;
	itemId: number | null;
	namaBarang: string;
	qtyRequired: number;
	qtyDelivered: number;
	unit: string;
	stokTersedia: number | null;
	stokLevel: 'hijau' | 'kuning' | 'merah' | 'tidak_diketahui';
}

export interface AntrianRow {
	id: number;
	nomorPl: string;
	status: string;
	prepStatus: string;
	priority: string;
	urgency: string;
	neededDate: string | null;
	requestDate: string | null;
	requestedByDepartment: string;
	destinationPicName: string;
	gudangId: number | null;
	assignedTo: number | null;
	assignedToName: string | null;
	itemCount: number;
	requestType: 'project' | 'maintenance' | 'internal' | '';
}

export interface AntrianDetail extends AntrianRow {
	items: AntrianItemRow[];
}

function computeStokLevel(stokTersedia: number | null, qtyRequired: number): AntrianItemRow['stokLevel'] {
	if (stokTersedia === null || Number.isNaN(stokTersedia)) return 'tidak_diketahui';
	if (stokTersedia <= 0) return 'merah';
	if (stokTersedia < qtyRequired) return 'kuning';
	return 'hijau';
}

/**
 * Daftar antrian persiapan — packing_list yang masih aktif (belum dispatched).
 * Tidak difilter ketat by gudang_id karena baris lama belum tertag; lihat catatan di atas.
 */
export async function getAntrianList(opts?: { limit?: number }): Promise<AntrianRow[]> {
	try {
		const rows = await directus.request(
			readItems('packing_list' as any, {
				fields: [
					'id', 'nomor_pl', 'status', 'prep_status', 'priority', 'urgency',
					'needed_date', 'request_date', 'requested_by_department', 'destination_pic_name',
					'gudang_id', 'assigned_to', 'assigned_to_name'
				] as any,
				filter: {
					status: { _in: ACTIONABLE_STATUS },
					_or: [
						{ prep_status: { _null: true } },
						{ prep_status: { _neq: DISPATCHED_PREP_STATUS } }
					]
				} as any,
				sort: ['-priority', 'needed_date'] as any,
				limit: opts?.limit ?? 100
			})
		);

		const plIds = (rows as any[]).map((r) => r.id);
		const itemCounts = await getItemCountsByPackingListIds(plIds);

		return (rows as any[]).map((r) => ({
			id: r.id,
			nomorPl: r.nomor_pl || `PL-${r.id}`,
			status: r.status || '',
			prepStatus: r.prep_status || 'pending',
			priority: r.priority || 'normal',
			urgency: r.urgency || 'normal',
			neededDate: r.needed_date || null,
			requestDate: r.request_date || null,
			requestedByDepartment: r.requested_by_department || '',
			destinationPicName: r.destination_pic_name || '',
			gudangId: r.gudang_id ?? null,
			assignedTo: r.assigned_to ?? null,
			assignedToName: r.assigned_to_name ?? null,
			itemCount: itemCounts[r.id] || 0,
			requestType: r.request_type || ''
		}));
	} catch (err) {
		console.warn('[gudangAntrian] Gagal memuat antrian.', err);
		try {
			handleDirectusError(err);
		} catch {
			// sudah di-log; kembalikan daftar kosong, jangan lempar error ke UI
		}
		return [];
	}
}

async function getItemCountsByPackingListIds(plIds: number[]): Promise<Record<number, number>> {
	if (plIds.length === 0) return {};
	try {
		const rows = await directus.request(
			readItems('packing_list_items' as any, {
				fields: ['packing_list_id'] as any,
				filter: { packing_list_id: { _in: plIds } } as any,
				limit: -1
			})
		);
		const counts: Record<number, number> = {};
		for (const r of rows as any[]) {
			const pid = r.packing_list_id;
			counts[pid] = (counts[pid] || 0) + 1;
		}
		return counts;
	} catch (err) {
		console.warn('[gudangAntrian] Gagal hitung jumlah item.', err);
		return {};
	}
}

/** Detail satu antrian: header packing_list + item-item beserta indikator stok hijau/kuning/merah. */
export async function getAntrianDetail(packingListId: number): Promise<AntrianDetail | null> {
	try {
		const [headerRows, itemRows] = await Promise.all([
			directus.request(
				readItems('packing_list' as any, {
					fields: [
						'id', 'nomor_pl', 'status', 'prep_status', 'priority', 'urgency',
						'needed_date', 'request_date', 'requested_by_department', 'destination_pic_name',
						'gudang_id', 'assigned_to', 'assigned_to_name', 'request_type'
					] as any,
					filter: { id: { _eq: packingListId } } as any,
					limit: 1
				})
			),
			directus.request(
				readItems('packing_list_items' as any, {
					fields: [
						'id', 'item_id', 'nama_barang', 'qty_required', 'qty_delivered', 'unit'
					] as any,
					filter: { packing_list_id: { _eq: packingListId } } as any,
					limit: -1
				})
			)
		]);

		const header = (headerRows as any[])[0];
		if (!header) return null;

		const itemIds = (itemRows as any[]).map((r) => r.item_id).filter((id) => id != null);
		const stokMap = await getStokTersediaMap(itemIds);

		const items: AntrianItemRow[] = (itemRows as any[]).map((r) => {
			const stokTersedia = r.item_id != null && stokMap[r.item_id] != null ? parseFloat(stokMap[r.item_id]) : null;
			const qtyRequired = Number(r.qty_required) || 0;
			return {
				id: r.id,
				itemId: r.item_id ?? null,
				namaBarang: r.nama_barang || '',
				qtyRequired,
				qtyDelivered: Number(r.qty_delivered) || 0,
				unit: r.unit || '',
				stokTersedia,
				stokLevel: computeStokLevel(stokTersedia, qtyRequired)
			};
		});

		return {
			id: header.id,
			nomorPl: header.nomor_pl || `PL-${header.id}`,
			status: header.status || '',
			prepStatus: header.prep_status || 'pending',
			priority: header.priority || 'normal',
			urgency: header.urgency || 'normal',
			neededDate: header.needed_date || null,
			requestDate: header.request_date || null,
			requestedByDepartment: header.requested_by_department || '',
			destinationPicName: header.destination_pic_name || '',
			gudangId: header.gudang_id ?? null,
			assignedTo: header.assigned_to ?? null,
			assignedToName: header.assigned_to_name ?? null,
			requestType: header.request_type || '',
			itemCount: items.length,
			items
		};
	} catch (err) {
		console.warn('[gudangAntrian] Gagal memuat detail antrian.', err);
		try {
			handleDirectusError(err);
		} catch {
			// sudah di-log
		}
		return null;
	}
}

// stok_tersedia bertipe STRING di Directus (identitas_barang) — _gt/_lt tak bisa dipakai di filter,
// wajib parseFloat di klien. Lihat memory feedback-stok-tersedia-string-type.
async function getStokTersediaMap(itemIds: number[]): Promise<Record<number, string>> {
	if (itemIds.length === 0) return {};
	try {
		const rows = await directus.request(
			readItems('identitas_barang' as any, {
				fields: ['id', 'stok_tersedia'] as any,
				filter: { id: { _in: itemIds } } as any,
				limit: -1
			})
		);
		const map: Record<number, string> = {};
		for (const r of rows as any[]) map[r.id] = r.stok_tersedia;
		return map;
	} catch (err) {
		console.warn('[gudangAntrian] Gagal memuat stok tersedia.', err);
		return {};
	}
}

// --- Fase 2: Picking & Mutasi (TULIS) --------------------------------------------------------

export interface PickSubmitParams {
	packingListId: number;
	packingListItemId: number;
	itemId: number;
	quantity: number;
	karyawanName: string;
	clientTxnId: string;
	evidencePhotoFileId?: string | null;
	lat?: number | null;
	lng?: number | null;
	accuracy?: number | null;
	capturedAt?: string | null;
}

export interface PickSubmitResult {
	success: boolean;
	error?: string;
	alreadySubmitted?: boolean;
}

/**
 * Submit picking satu item dari antrian. Aturan wajib (rencana implementasi Fase 2):
 * - qty tidak boleh melebihi sisa yang diminta (qty_required - qty_delivered saat ini, dibaca live)
 * - foto/GPS wajib bila diaktifkan di setelan inventory.gudang_hq.*
 * - idempoten via clientTxnId (lihat submitGudangPick di stockLapangan.ts)
 * - stok_tersedia HANYA diubah lewat writeStockMovement (jalur sama dengan admin), tidak ditulis
 *   langsung di sini.
 */
export async function submitPicking(params: PickSubmitParams): Promise<PickSubmitResult> {
	await loadInventorySettings();
	const wajibFoto = getInventorySetting('inventory.gudang_hq.wajib_foto_pick');
	const wajibGps = getInventorySetting('inventory.gudang_hq.wajib_gps');
	const gudangIds: number[] = getInventorySetting('inventory.gudang_hq.gudang_ids') || [1];

	if (wajibFoto && !params.evidencePhotoFileId) {
		return { success: false, error: 'Foto bukti wajib diisi sebelum submit.' };
	}
	if (wajibGps && (params.lat == null || params.lng == null)) {
		return { success: false, error: 'GPS wajib aktif sebelum submit.' };
	}
	if (!(params.quantity > 0)) {
		return { success: false, error: 'Qty harus lebih dari 0.' };
	}

	let item: any;
	try {
		const itemRows = await directus.request(
			readItems('packing_list_items' as any, {
				fields: ['id', 'qty_required', 'qty_delivered'] as any,
				filter: { id: { _eq: params.packingListItemId } } as any,
				limit: 1
			})
		);
		item = (itemRows as any[])[0];
	} catch (err) {
		console.warn('[gudangAntrian] Gagal baca item sebelum submit.', err);
		return { success: false, error: 'Gagal membaca data item. Coba lagi.' };
	}
	if (!item) return { success: false, error: 'Item packing list tidak ditemukan.' };

	const qtyRequired = Number(item.qty_required) || 0;
	const qtyDeliveredBefore = Number(item.qty_delivered) || 0;
	const remaining = qtyRequired - qtyDeliveredBefore;

	if (params.quantity > remaining + 0.0001) {
		return { success: false, error: `Qty melebihi sisa yang diminta (sisa ${remaining}).` };
	}

	try {
		const result = await submitGudangPick({
			itemId: params.itemId,
			quantity: params.quantity,
			packingListId: params.packingListId,
			karyawanName: params.karyawanName,
			clientTxnId: params.clientTxnId,
			gudangId: gudangIds[0] ?? null,
			evidencePhotoFileId: params.evidencePhotoFileId ?? null,
			lat: params.lat ?? null,
			lng: params.lng ?? null,
			accuracy: params.accuracy ?? null,
			capturedAt: params.capturedAt ?? null,
			scanMethod: 'manual_search'
		});

		// Duplikat (submit ulang dgn clientTxnId sama) berarti langkah ini sudah pernah
		// dijalankan sampai selesai sebelumnya — jangan tambah qty_delivered dua kali.
		if (!result.alreadySubmitted) {
			const newQtyDelivered = qtyDeliveredBefore + params.quantity;
			await directus.request(
				updateItem('packing_list_items' as any, params.packingListItemId, {
					qty_delivered: newQtyDelivered
				} as any)
			);
			await recomputePackingListProgress(params.packingListId);
		}

		return { success: true, alreadySubmitted: result.alreadySubmitted };
	} catch (err) {
		console.error('[gudangAntrian] Gagal submit picking.', err);
		return { success: false, error: 'Gagal menyimpan ke server. Coba lagi.' };
	}
}

async function recomputePackingListProgress(packingListId: number): Promise<void> {
	const itemRows = await directus.request(
		readItems('packing_list_items' as any, {
			fields: ['id', 'qty_required', 'qty_delivered'] as any,
			filter: { packing_list_id: { _eq: packingListId } } as any,
			limit: -1
		})
	);
	const items = itemRows as any[];
	const totalRequired = items.reduce((s, i) => s + (Number(i.qty_required) || 0), 0);
	const totalDelivered = items.reduce((s, i) => s + (Number(i.qty_delivered) || 0), 0);
	const pct = totalRequired > 0 ? Math.min(100, Math.round((totalDelivered / totalRequired) * 100)) : 0;
	const allDelivered =
		items.length > 0 &&
		items.every((i) => (Number(i.qty_delivered) || 0) >= (Number(i.qty_required) || 0) - 0.0001);
	const anyDelivered = items.some((i) => (Number(i.qty_delivered) || 0) > 0);
	const prepStatus = allDelivered ? 'packed' : anyDelivered ? 'picking' : 'pending';

	await directus.request(
		updateItem('packing_list' as any, packingListId, {
			total_qty_required: totalRequired,
			total_qty_delivered: totalDelivered,
			completion_percentage: pct,
			prep_status: prepStatus
		} as any)
	);
}

/**
 * Tandai antrian selesai disiapkan & dikirim (dispatched). Boleh dipanggil dengan pengiriman
 * belum penuh hanya bila inventory.gudang_hq.boleh_kirim_sebagian=true (Q2.4).
 */
export async function dispatchAntrian(packingListId: number): Promise<{ success: boolean; error?: string }> {
	await loadInventorySettings();
	const bolehSebagian = getInventorySetting('inventory.gudang_hq.boleh_kirim_sebagian');

	const detail = await getAntrianDetail(packingListId);
	if (!detail) return { success: false, error: 'Antrian tidak ditemukan.' };
	if (detail.items.length === 0 || detail.items.every((i) => i.qtyDelivered <= 0)) {
		return { success: false, error: 'Belum ada item yang di-pick.' };
	}

	const allDelivered = detail.items.every((i) => i.qtyDelivered >= i.qtyRequired - 0.0001);
	if (!allDelivered && !bolehSebagian) {
		return {
			success: false,
			error: 'Belum semua item terkirim penuh — pengiriman sebagian tidak diizinkan (lihat setelan).'
		};
	}

	try {
		await directus.request(
			updateItem('packing_list' as any, packingListId, { prep_status: 'dispatched' } as any)
		);
		return { success: true };
	} catch (err) {
		console.error('[gudangAntrian] Gagal dispatch antrian.', err);
		return { success: false, error: 'Gagal menandai selesai.' };
	}
}

// --- Fase 3: Opname Gudang Pusat --------------------------------------------------------------

export interface OpnameGudangHqParams {
	itemId: number;
	systemStock: number;
	physicalCount: number;
	notes: string;
	karyawanName: string;
}

export interface OpnameGudangHqResult {
	status: 'no_change' | 'auto_approved' | 'menunggu_approval';
	deltaPct: number;
	result?: StockMovementResult;
}

/**
 * Opname dengan scope Gudang Pusat (Fase 3): selisih dalam batas toleransi setting
 * langsung diterapkan ke stok; di luar toleransi masuk antrian approval (tidak mengubah
 * stok sampai admin approve di /inventory/verifikasi-lapangan — lihat submitOpnameAdjustment).
 */
export async function submitOpnameGudangHq(
	params: OpnameGudangHqParams & EvidenceParams
): Promise<OpnameGudangHqResult> {
	const delta = params.physicalCount - params.systemStock;
	if (delta === 0) return { status: 'no_change', deltaPct: 0 };

	await loadInventorySettings();
	const toleransiPct: number = getInventorySetting('inventory.gudang_hq.toleransi_selisih_pct') ?? 0;
	const wajibApproval: boolean = getInventorySetting('inventory.gudang_hq.opname_wajib_approval');

	const deltaPct = params.systemStock > 0 ? (Math.abs(delta) / params.systemStock) * 100 : 100;
	const autoApprove = !wajibApproval || deltaPct <= toleransiPct;

	const result = await submitOpnameAdjustment({
		itemId: params.itemId,
		type: delta > 0 ? 'IN' : 'OUT',
		quantity: Math.abs(delta),
		notes: params.notes,
		karyawanName: params.karyawanName,
		applyToStock: autoApprove,
		lat: params.lat ?? null,
		lng: params.lng ?? null,
		accuracy: params.accuracy ?? null,
		capturedAt: params.capturedAt ?? null,
		evidencePhotoFileId: params.evidencePhotoFileId ?? null,
		scanMethod: params.scanMethod ?? null,
		gudangId: params.gudangId ?? null
	});

	return { status: autoApprove ? 'auto_approved' : 'menunggu_approval', deltaPct, result };
}
