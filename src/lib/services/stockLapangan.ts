import directus, { handleDirectusError } from './directus';
import { readItems, readItem, createItem, updateItem, uploadFiles } from '@directus/sdk';

// DRAFT — nilai category_transaction & field source/client_txn_id belum final,
// perlu dikoordinasikan dengan tim admin :9391 (lihat Fase 0 di rencana implementasi).
export const STOCK_LAPANGAN_CATEGORY = {
	FIELD_RECEIPT: 'FIELD_RECEIPT',
	PRODUCTION_OUTPUT: 'PRODUCTION_OUTPUT',
	OPNAME_ADJ: 'OPNAME_ADJ',
	// Gudang Pusat Bojongkulur v2 (Fase 2) — mutasi OUT dari picking packing_list.
	HQ_PICK_OUT: 'HQ_PICK_OUT'
} as const;

const SOURCE_PREFIX = 'field:';

export interface StockItemOption {
	id: number;
	nama_barang_lengkap: string;
	satuan: string;
	stok_tersedia: string;
	kode_item?: string | null;
}

export interface ReorderAlertItem {
	itemId: number;
	namaBarang: string;
	satuan: string;
	stokTersedia: number;
	stokMinimum: number;
}

export interface SpkReservationItem {
	itemId: number;
	namaBarang: string;
	satuan: string;
	spkId: number;
	quantity: number;
}

export interface PackingPipelineItem {
	id: number;
	materialName: string;
	qty: number;
	unit: string;
	packingStatus: string;
	requestedAt: string | null;
}

export interface JatahEligibleItem {
	itemId: number;
	namaBarang: string;
	satuan: string;
	nama: string;
	qtyJatah: number;
}

export interface PersiapanHarian {
	reorderAlerts: ReorderAlertItem[];
	spkReservations: SpkReservationItem[];
	packingPipeline: PackingPipelineItem[];
	jatahEligible: JatahEligibleItem[];
}

// Kategori parent_category di identitas_barang (lihat getCategoryName() erp-epi-1/suratJalanApi.js).
const PARENT_CATEGORY_FINISHGOOD = 142;

export interface FinishGoodStockItem {
	itemId: number;
	namaBarang: string;
	satuan: string;
	stokTersedia: number;
}

export interface StockMovementResult {
	id: number;
	previous_stock: number;
	new_stock: number;
	reference_no: string;
}

export interface StockTransactionRow {
	id: number;
	itemName: string;
	transactionType: string;
	categoryTransaction: string;
	quantity: number;
	referenceNo: string;
	source: string;
	transactionDate: string;
	verificationStatus: 'pending' | 'verified' | 'rejected' | 'revised';
	rejectReason: string | null;
}

function generateReferenceNo(): string {
	const now = new Date();
	const yy = String(now.getFullYear()).slice(-2);
	const mm = String(now.getMonth() + 1).padStart(2, '0');
	const dd = String(now.getDate()).padStart(2, '0');
	const random = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
	return `SL-${yy}${mm}${dd}-${random}`;
}

async function fetchItemNameMap(itemIds: number[]): Promise<Map<number, { nama: string; satuan: string }>> {
	const map = new Map<number, { nama: string; satuan: string }>();
	if (!itemIds.length) return map;
	const items = (await directus.request(
		readItems('identitas_barang', {
			filter: { id: { _in: [...new Set(itemIds)] } },
			fields: ['id', 'nama_barang_lengkap', 'satuan'],
			limit: -1
		})
	)) as any[];
	for (const item of items) map.set(item.id, { nama: item.nama_barang_lengkap, satuan: item.satuan });
	return map;
}

export async function getReorderAlerts(): Promise<ReorderAlertItem[]> {
	try {
		const items = (await directus.request(
			readItems('identitas_barang', {
				fields: ['id', 'nama_barang_lengkap', 'satuan', 'stok_tersedia', 'stok_minimum'],
				limit: -1
			})
		)) as any[];
		return items
			.map((item) => ({
				itemId: item.id,
				namaBarang: item.nama_barang_lengkap,
				satuan: item.satuan,
				stokTersedia: parseFloat(item.stok_tersedia) || 0,
				stokMinimum: Number(item.stok_minimum) || 0
			}))
			.filter((item) => item.stokMinimum > 0 && item.stokTersedia < item.stokMinimum);
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/**
 * Snapshot stok Finish Good tersedia (parent_category=142), dipakai lajur "Finish Good → Kirim".
 * CATATAN: ini snapshot stok, BUKAN antrian pengiriman — tidak ada field yang menautkan baris
 * produksi ke Surat Jalan (dicek: submitHasilProduksi tidak isi destination_type/id/name,
 * stock_transactions tak punya kolom surat_jalan_id/is_shipped). Sampai penautan itu dibuat,
 * ini hanya "ada stok FG" bukan "belum dikirim khusus".
 */
export async function getFinishGoodStock(): Promise<FinishGoodStockItem[]> {
	try {
		const items = (await directus.request(
			readItems('identitas_barang', {
				filter: { parent_category: { _eq: PARENT_CATEGORY_FINISHGOOD } },
				fields: ['id', 'nama_barang_lengkap', 'satuan', 'stok_tersedia'],
				limit: -1
			})
		)) as any[];
		return items
			.map((item) => ({
				itemId: item.id,
				namaBarang: item.nama_barang_lengkap,
				satuan: item.satuan,
				stokTersedia: parseFloat(item.stok_tersedia) || 0
			}))
			.filter((item) => item.stokTersedia > 0)
			.sort((a, b) => b.stokTersedia - a.stokTersedia);
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function getSpkReservationsActive(): Promise<SpkReservationItem[]> {
	try {
		const reservations = (await directus.request(
			readItems('stock_reservations', {
				filter: { status: { _eq: 'active' } },
				fields: ['id', 'spk_id', 'item_id', 'quantity'],
				limit: -1
			})
		)) as any[];
		const nameMap = await fetchItemNameMap(reservations.map((r) => r.item_id).filter(Boolean));
		return reservations.map((r) => ({
			itemId: r.item_id,
			namaBarang: nameMap.get(r.item_id)?.nama || `Barang #${r.item_id}`,
			satuan: nameMap.get(r.item_id)?.satuan || '',
			spkId: r.spk_id,
			quantity: Number(r.quantity) || 0
		}));
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function getPackingPipelineItems(): Promise<PackingPipelineItem[]> {
	try {
		const result = (await directus.request(
			readItems('project_budgets', {
				filter: { packing_status: { _in: ['requested', 'approved'] } },
				fields: ['id', 'material_name', 'qty', 'unit', 'packing_status', 'requested_at'],
				sort: ['requested_at'],
				limit: -1
			})
		)) as any[];
		return result.map((row) => ({
			id: row.id,
			materialName: row.material_name || '-',
			qty: Number(row.qty) || 0,
			unit: row.unit || '',
			packingStatus: row.packing_status,
			requestedAt: row.requested_at
		}));
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function getJatahEligible(): Promise<JatahEligibleItem[]> {
	try {
		const jatah = (await directus.request(
			readItems('jatah_barang', {
				filter: { aktif: { _eq: true } },
				fields: ['id', 'item_id', 'nama', 'scope_type', 'scope_value', 'qty_jatah'],
				limit: -1
			})
		)) as any[];
		if (!jatah.length) return [];
		const nameMap = await fetchItemNameMap(jatah.map((j) => j.item_id).filter(Boolean));
		return jatah.map((j) => ({
			itemId: j.item_id,
			namaBarang: nameMap.get(j.item_id)?.nama || `Barang #${j.item_id}`,
			satuan: nameMap.get(j.item_id)?.satuan || '',
			nama: j.nama,
			qtyJatah: Number(j.qty_jatah) || 0
		}));
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function getPersiapanHarian(): Promise<PersiapanHarian> {
	const [reorderAlerts, spkReservations, packingPipeline, jatahEligible] = await Promise.all([
		getReorderAlerts(),
		getSpkReservationsActive(),
		getPackingPipelineItems(),
		getJatahEligible()
	]);
	return { reorderAlerts, spkReservations, packingPipeline, jatahEligible };
}

export async function getItemsForPicker(search?: string): Promise<StockItemOption[]> {
	try {
		const q = (search || '').trim();
		const result = await directus.request(
			readItems('identitas_barang', {
				filter: q ? { nama_barang_lengkap: { _icontains: q } } : {},
				fields: ['id', 'nama_barang_lengkap', 'satuan', 'stok_tersedia', 'kode_item'],
				sort: ['nama_barang_lengkap'],
				limit: 50
			})
		);
		return (result || []) as StockItemOption[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

// Fallback saat scan QR gagal (bukan format EPI:ITEM internal, mis. barcode vendor tertempel
// di kemasan) -- coba treat nilai scan sebagai kode_item/kode_singkat_item/barcode_vendor/
// id_equipment, bukan langsung menyerah ke pencarian manual (audit barcode 17 Sep 2026,
// Temuan #7b). id_equipment ditambahkan di Fase 1 -- 99% item EQUIPMENT tanpa kode_item
// ternyata sudah punya id_equipment terisi (Temuan #2).
export async function findItemByCode(code: string): Promise<StockItemOption | null> {
	const term = code.trim();
	if (!term) return null;
	try {
		const result = await directus.request(
			readItems('identitas_barang', {
				filter: {
					_or: [
						{ kode_item: { _icontains: term } },
						{ kode_singkat_item: { _icontains: term } },
						{ barcode_vendor: { _icontains: term } },
						{ id_equipment: { _icontains: term } }
					]
				},
				fields: ['id', 'nama_barang_lengkap', 'satuan', 'stok_tersedia', 'kode_item', 'kode_singkat_item', 'barcode_vendor', 'id_equipment'],
				limit: 5
			})
		);
		const rows = (result || []) as any[];
		const target = term.toUpperCase();
		const exact = rows.find(
			(r) =>
				(r.kode_item || '').trim().toUpperCase() === target ||
				(r.kode_singkat_item || '').trim().toUpperCase() === target ||
				(r.barcode_vendor || '').trim().toUpperCase() === target ||
				(r.id_equipment || '').trim().toUpperCase() === target
		);
		const picked = exact || rows[0];
		if (!picked) return null;
		return {
			id: picked.id,
			nama_barang_lengkap: picked.nama_barang_lengkap,
			satuan: picked.satuan,
			stok_tersedia: picked.stok_tersedia,
			kode_item: picked.kode_item
		};
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export interface GudangOption {
	id: number;
	nama_gudang: string;
	jenis: string | null;
}

/** F0 (Rencana Implementasi Inventory v2.0): daftar gudang aktif untuk atribusi lokasi transaksi.
 *  Fase 0 (Rencana Sistem Penempatan Area Inventory v2, 20 Agu 2026): filter parent_gudang_id
 *  null -- rak/zona (anak, dibuat mulai Fase 1 di erp-epi-1) TIDAK boleh muncul di dropdown
 *  transaksi lapangan ini (Opname/Masuk/Output). */
export async function fetchGudangList(): Promise<GudangOption[]> {
	try {
		const result = await directus.request(
			readItems('gudang', {
				filter: { is_active: { _eq: true }, parent_gudang_id: { _null: true } },
				fields: ['id', 'nama_gudang', 'jenis'],
				sort: ['nama_gudang']
			})
		);
		return (result || []) as GudangOption[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/** Cari gudang area proyek dari project id (konvensi kode_gudang = "PROY-<project_id>", sama
 *  persis dengan getProjectGudangId di erp-epi-1/inventoryApi.js). Dipakai untuk GR dari Surat
 *  Jalan (Fase 5, 21 Agu 2026): tujuan penerimaan HARUS gudang proyek itu sendiri, bukan pilihan
 *  bebas -- ini penerimaan fisik di lokasi proyek, bukan gudang admin mana pun. */
export async function getProjectGudangId(projectId: number | null): Promise<number | null> {
	if (!projectId) return null;
	try {
		const result = await directus.request(
			readItems('gudang', {
				filter: { kode_gudang: { _eq: `PROY-${projectId}` } },
				fields: ['id'],
				limit: 1
			})
		);
		return (result?.[0] as any)?.id ?? null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/** Fase 5 (opsional, Rencana Sistem Penempatan Area Inventory v2, 21 Agu 2026): anak langsung
 *  (rak/zona) dari satu node gudang, untuk dropdown "Rak (opsional)" di form masuk/keluar/opname. */
export async function fetchGudangChildren(parentId: number | null): Promise<GudangOption[]> {
	if (!parentId) return [];
	try {
		const result = await directus.request(
			readItems('gudang', {
				filter: { is_active: { _eq: true }, parent_gudang_id: { _eq: parentId } },
				fields: ['id', 'nama_gudang', 'jenis'],
				sort: ['nama_gudang']
			})
		);
		return (result || []) as GudangOption[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export type ScanMethod = 'qr_item' | 'qr_location' | 'manual_search' | 'barcode';

export interface EvidenceParams {
	lat?: number | null;
	lng?: number | null;
	accuracy?: number | null;
	capturedAt?: string | null;
	evidencePhotoFileId?: string | null;
	scanMethod?: ScanMethod | null;
	gudangId?: number | null;
	itemBatchId?: number | null;
	/** F0 (Rencana Implementasi Inventory v2.0): tipe tujuan/asal transaksi, mis. 'project' */
	destinationType?: string | null;
	/** F0: id record tujuan/asal, mis. id proyek */
	destinationId?: number | string | null;
	/** F0: nama tujuan/asal untuk tampilan (opsional, tanpa perlu join) */
	destinationName?: string | null;
}

async function writeStockMovement(
	params: {
		itemId: number;
		type: 'IN' | 'OUT';
		quantity: number;
		category: string;
		notes: string;
		karyawanName: string;
		referenceType?: string | null;
		referenceId?: number | null;
		clientTxnId?: string;
		/** false = jangan sentuh stok master, catat sebagai draft pending approval (Fase 3 Gudang Pusat). Default true. */
		applyToStock?: boolean;
		statusOverride?: 'draft' | 'published';
		verificationStatusOverride?: 'pending' | 'verified';
	} & EvidenceParams
): Promise<StockMovementResult> {
	const item: any = await directus.request(
		readItem('identitas_barang', params.itemId, { fields: ['id', 'stok_tersedia'] })
	);
	const previousStock = parseFloat(item.stok_tersedia) || 0;
	const newStock = params.type === 'OUT' ? previousStock - params.quantity : previousStock + params.quantity;
	const referenceNo = generateReferenceNo();
	const applyToStock = params.applyToStock !== false;

	// Fase 0.6 (Rencana Implementasi Inventory Proyek v2.0, 24 Juli 2026): gerbang verifikasi
	// dimatikan atas keputusan user — 1 dari 14.703 transaksi lapangan pernah diverifikasi sejak
	// Fase 1 lama, sehingga stok resmi nyaris tak pernah ter-update. Transaksi lapangan sekarang
	// langsung mengubah stok master saat ditulis; verification_status tetap dicatat 'verified'
	// untuk kompatibilitas skema, bukan sebagai gerbang aktif — KECUALI applyToStock=false
	// (Fase 3 Gudang Pusat v2: opname selisih > toleransi masuk ke inbox verifikasi lapangan
	// existing, stok TIDAK berubah sampai admin approve di /inventory/verifikasi-lapangan).
	if (applyToStock) {
		await directus.request(
			updateItem('identitas_barang', params.itemId, { stok_tersedia: String(newStock) })
		);
	}

	const tx: any = await directus.request(
		createItem('stock_transactions', {
			item_id: params.itemId,
			transaction_type: params.type,
			category_transaction: params.category,
			quantity: params.quantity,
			previous_stock: previousStock,
			new_stock: newStock,
			reference_no: referenceNo,
			notes: params.notes || null,
			status: params.statusOverride ?? 'published',
			verification_status: params.verificationStatusOverride ?? 'verified',
			verified_at: applyToStock ? new Date().toISOString() : null,
			transaction_date: new Date().toISOString(),
			source: `${SOURCE_PREFIX}${params.karyawanName}`,
			client_txn_id: params.clientTxnId || crypto.randomUUID(),
			reference_type: params.referenceType ?? null,
			reference_id: params.referenceId ?? null,
			evidence_gps_lat: params.lat ?? null,
			evidence_gps_lng: params.lng ?? null,
			evidence_gps_accuracy: params.accuracy ?? null,
			evidence_captured_at: params.capturedAt ?? null,
			evidence_photo: params.evidencePhotoFileId ?? null,
			scan_method: params.scanMethod ?? null,
			gudang_id: params.gudangId ?? null,
			item_batch_id: params.itemBatchId ?? null,
			destination_type: params.destinationType ?? null,
			destination_id: params.destinationId ?? null,
			destination_name: params.destinationName ?? null
		})
	);

	return { id: tx.id, previous_stock: previousStock, new_stock: newStock, reference_no: referenceNo };
}

/** Fase 1: buat record item_batch baru untuk penerimaan barang dan tautkan ke transaksinya. */
async function createReceiptBatch(params: {
	itemId: number;
	quantity: number;
	lotNumber: string;
	expiryDate?: string | null;
	gudangId?: number | null;
	sourceTransactionId: number;
}): Promise<number | null> {
	try {
		const item: any = await directus.request(
			readItem('identitas_barang', params.itemId, { fields: ['id', 'satuan'] })
		);
		const batch: any = await directus.request(
			createItem('item_batch', {
				item_id: params.itemId,
				lot_number: params.lotNumber,
				tanggal_terima: new Date().toISOString().slice(0, 10),
				tanggal_kadaluarsa: params.expiryDate || null,
				qty_awal: params.quantity,
				qty_tersisa: params.quantity,
				satuan: item?.satuan || null,
				gudang_id: params.gudangId ?? null,
				status: 'active',
				source_transaction_id: params.sourceTransactionId
			})
		);
		return batch?.id || null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export function suggestLotNumber(): string {
	const now = new Date();
	const yy = String(now.getFullYear()).slice(-2);
	const mm = String(now.getMonth() + 1).padStart(2, '0');
	const dd = String(now.getDate()).padStart(2, '0');
	const random = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
	return `LOT-${yy}${mm}${dd}-${random}`;
}

export async function submitPenerimaan(
	params: {
		itemId: number;
		quantity: number;
		notes: string;
		karyawanName: string;
		lotNumber?: string;
		expiryDate?: string | null;
	} & EvidenceParams
): Promise<StockMovementResult> {
	const result = await writeStockMovement({
		...params,
		type: 'IN',
		category: STOCK_LAPANGAN_CATEGORY.FIELD_RECEIPT
	});

	if (params.lotNumber) {
		const batchId = await createReceiptBatch({
			itemId: params.itemId,
			quantity: params.quantity,
			lotNumber: params.lotNumber,
			expiryDate: params.expiryDate,
			gudangId: params.gudangId,
			sourceTransactionId: result.id
		});
		if (batchId) {
			try {
				await directus.request(updateItem('stock_transactions', result.id, { item_batch_id: batchId }));
			} catch (error) {
				handleDirectusError(error);
			}
		}
	}

	return result;
}

export async function submitHasilProduksi(
	params: {
		itemId: number;
		quantity: number;
		notes: string;
		karyawanName: string;
	} & EvidenceParams
): Promise<StockMovementResult> {
	return writeStockMovement({ ...params, type: 'IN', category: STOCK_LAPANGAN_CATEGORY.PRODUCTION_OUTPUT });
}

/**
 * Mutasi OUT dari picking packing list — Gudang Pusat Bojongkulur v2 (Fase 2).
 * Aturan tak bisa ditawar (rencana implementasi, Fase 2): 1 baris stock_transactions per
 * submit (bukan tabel baru), lewat jalur yang sama dengan admin (writeStockMovement),
 * idempoten via client_txn_id unik (kolom ber-constraint UNIQUE di Directus) — submit ulang
 * dengan clientTxnId yang sama TIDAK membuat baris kedua, cukup dikembalikan sebagai
 * alreadySubmitted.
 */
export async function submitGudangPick(
	params: {
		itemId: number;
		quantity: number;
		packingListId: number;
		karyawanName: string;
		clientTxnId: string;
		notes?: string;
	} & EvidenceParams
): Promise<StockMovementResult & { alreadySubmitted: boolean }> {
	const existing = await directus.request(
		readItems('stock_transactions', {
			filter: { client_txn_id: { _eq: params.clientTxnId } },
			fields: ['id', 'previous_stock', 'new_stock', 'reference_no'],
			limit: 1
		})
	);
	const found = (existing as any[])[0];
	if (found) {
		return {
			id: found.id,
			previous_stock: found.previous_stock,
			new_stock: found.new_stock,
			reference_no: found.reference_no,
			alreadySubmitted: true
		};
	}

	const result = await writeStockMovement({
		...params,
		type: 'OUT',
		category: STOCK_LAPANGAN_CATEGORY.HQ_PICK_OUT,
		notes: params.notes || `Picking packing list #${params.packingListId}`,
		referenceType: 'PACKING_LIST',
		referenceId: params.packingListId
	});
	return { ...result, alreadySubmitted: false };
}

/**
 * Opname dengan gerbang approval — Gudang Pusat Bojongkulur v2 (Fase 3). Beda dari submitOpname
 * biasa (selalu langsung ubah stok): saat applyToStock=false, transaksi dicatat sebagai
 * draft/pending dan MUNCUL OTOMATIS di inbox /inventory/verifikasi-lapangan existing
 * (fieldVerificationApi.js hanya syarat source starts_with 'field:' + verification_status
 * pending — tidak peduli kategori) — stok master baru berubah saat admin approve di sana.
 * Keputusan auto-approve vs pending dihitung oleh pemanggil (gudangAntrian.ts, baca setting).
 */
export async function submitOpnameAdjustment(
	params: {
		itemId: number;
		quantity: number;
		type: 'IN' | 'OUT';
		notes: string;
		karyawanName: string;
		applyToStock: boolean;
	} & EvidenceParams
): Promise<StockMovementResult> {
	return writeStockMovement({
		...params,
		category: STOCK_LAPANGAN_CATEGORY.OPNAME_ADJ,
		statusOverride: params.applyToStock ? 'published' : 'draft',
		verificationStatusOverride: params.applyToStock ? 'verified' : 'pending'
	});
}

export async function uploadEvidencePhoto(file: File, description: string): Promise<string | null> {
	try {
		const formData = new FormData();
		formData.append('file', file);
		formData.append('description', description);
		const result: any = await directus.request(uploadFiles(formData));
		return result?.id || null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/** @deprecated pakai uploadEvidencePhoto(file, 'stock_opname:evidence') */
export async function uploadOpnameEvidence(file: File): Promise<string | null> {
	return uploadEvidencePhoto(file, 'stock_opname:evidence');
}

export async function submitOpname(
	params: {
		itemId: number;
		systemStock: number;
		physicalCount: number;
		notes: string;
		karyawanName: string;
	} & EvidenceParams
): Promise<StockMovementResult | null> {
	const delta = params.physicalCount - params.systemStock;
	if (delta === 0) return null;

	return writeStockMovement({
		itemId: params.itemId,
		type: delta > 0 ? 'IN' : 'OUT',
		quantity: Math.abs(delta),
		category: STOCK_LAPANGAN_CATEGORY.OPNAME_ADJ,
		notes: params.notes,
		karyawanName: params.karyawanName,
		lat: params.lat,
		lng: params.lng,
		accuracy: params.accuracy,
		capturedAt: params.capturedAt,
		evidencePhotoFileId: params.evidencePhotoFileId,
		scanMethod: params.scanMethod,
		gudangId: params.gudangId,
		itemBatchId: params.itemBatchId,
		destinationType: params.destinationType,
		destinationId: params.destinationId,
		destinationName: params.destinationName
	});
}

export async function getRiwayat(options: { limit?: number } = {}): Promise<StockTransactionRow[]> {
	try {
		const result = (await directus.request(
			readItems('stock_transactions', {
				filter: { source: { _starts_with: SOURCE_PREFIX } },
				fields: [
					'id',
					'item_id',
					'transaction_type',
					'category_transaction',
					'quantity',
					'reference_no',
					'source',
					'transaction_date',
					'verification_status',
					'reject_reason'
				],
				sort: ['-transaction_date'],
				limit: options.limit ?? 100
			})
		)) as any[];
		const nameMap = await fetchItemNameMap(result.map((r) => r.item_id).filter(Boolean));
		return result.map((row) => ({
			id: row.id,
			itemName: nameMap.get(row.item_id)?.nama || `Barang #${row.item_id}`,
			transactionType: row.transaction_type,
			categoryTransaction: row.category_transaction,
			quantity: Number(row.quantity) || 0,
			referenceNo: row.reference_no,
			source: row.source,
			transactionDate: row.transaction_date,
			verificationStatus: row.verification_status || 'pending',
			rejectReason: row.reject_reason || null
		}));
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}
