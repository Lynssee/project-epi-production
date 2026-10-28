// src/lib/services/procurementApi.ts
// Fase 3 Procurement (Cepat & Mobile): PR dari lapangan, approval mobile, tracking PO,
// konfirmasi terima barang lapangan. Menyambung ke koleksi Directus yang sama dengan
// ERP Admin (erp-epi-1/src/lib/services/procurementApi.js): pengajuan, items_pengajuan,
// purchase_orders_supplier, purchase_order_supplier_items.
//
// Catatan penting: "Terima Barang" di sini TIDAK mengubah received_qty/stok/jurnal —
// itu tetap final di Admin (DaftarPO). Mobile hanya mengirim konfirmasi/bukti foto ke
// koleksi po_field_confirmations sebagai audit, supaya tidak ada risiko duplikasi stok
// antara dua codebase yang berbeda.
import directus, { handleDirectusError } from './directus';
import { readItems, readItem, createItem, updateItem } from '@directus/sdk';

export { uploadEvidencePhoto } from './stockLapangan';

export interface PengajuanLapanganItem {
	nama_barang: string;
	identitas_barang_id?: number | null;
	quantity: number;
	units: string;
	harga?: number | null;
}

export interface PengajuanSummary {
	id: number;
	status: string;
	stock_gate_status: string | null;
	nama_pengaju: string;
	department: string;
	tujuan_pengajuan: string;
	date_created: string;
}

/** Ambil divisi (department) karyawan dari Directus — dipakai untuk bypass Gerbang Stok Inventory. */
export async function getKaryawanDivisi(karyawanId: number): Promise<string> {
	try {
		const k: any = await directus.request(readItem('karyawan', karyawanId, { fields: ['divisi'] }));
		return k?.divisi || '';
	} catch (error) {
		handleDirectusError(error);
		return '';
	}
}

export async function fetchMyPengajuan(namaPengaju: string): Promise<PengajuanSummary[]> {
	try {
		const rows = (await directus.request(
			readItems('pengajuan', {
				filter: { nama_pengaju: { _eq: namaPengaju } },
				fields: [
					'id',
					'status',
					'stock_gate_status',
					'nama_pengaju',
					'department',
					'tujuan_pengajuan',
					'date_created'
				],
				sort: ['-date_created'],
				limit: 50
			})
		)) as any[];
		return rows as PengajuanSummary[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export interface PengajuanDetail extends PengajuanSummary {
	urgency: string;
	is_non_stock: boolean;
	payment_method: string | null;
	kategori_pembelian: string | null;
	custom_fields_data: Record<string, any> | null;
	items: PengajuanLapanganItem[];
}

/**
 * Detail lengkap satu PR milik user (header + item) — dipakai fitur "Ajukan Ulang"
 * (23 Agu 2026). Hanya dipanggil untuk PR milik nama_pengaju yang sama; caller wajib
 * memfilter dulu (lihat fetchMyPengajuan) sebelum menawarkan tombol ini ke user.
 */
export async function fetchPengajuanDetail(id: number): Promise<PengajuanDetail | null> {
	try {
		const [header, items] = await Promise.all([
			directus.request(
				readItem('pengajuan', id, {
					fields: [
						'id', 'status', 'stock_gate_status', 'nama_pengaju', 'department', 'urgency',
						'tujuan_pengajuan', 'date_created', 'is_non_stock', 'payment_method',
						'kategori_pembelian', 'custom_fields_data'
					]
				})
			),
			directus.request(
				readItems('items_pengajuan', {
					filter: { request_id: { _eq: id } },
					fields: ['nama_barang', 'identitas_barang_id', 'quantity', 'units', 'harga'],
					limit: -1
				})
			)
		]);
		return { ...(header as any), items: items as PengajuanLapanganItem[] };
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export interface ApprovalTask {
	id: number;
	nama_pengaju: string;
	department: string;
	tujuan_pengajuan: string;
	urgency: string;
	stock_gate_status: string | null;
	total_estimasi: number;
}

// PR yang sudah selesai/ditolak/menunggu gerbang stok tidak relevan untuk approval "atasan" mobile
const APPROVAL_EXCLUDED_STATUSES = ['Rejected', 'Cancelled', 'Digabungkan', 'Menunggu Review Inventory'];

/**
 * Ambil PR yang menunggu approval "atasan/kepala dept" (stage department_manager) —
 * sesuai cakupan approval mobile di rencana Fase 3 ("approver budget/kepala dept dari HP").
 */
export async function fetchApprovalTasks(): Promise<ApprovalTask[]> {
	try {
		const rows = (await directus.request(
			readItems('pengajuan', {
				filter: {
					_and: [
						{ department_manager_approved: { _eq: false } },
						{ department_manager_rejected: { _eq: false } },
						{ status: { _nin: APPROVAL_EXCLUDED_STATUSES } }
					]
				},
				fields: [
					'id',
					'nama_pengaju',
					'department',
					'tujuan_pengajuan',
					'urgency',
					'stock_gate_status',
					'item_pengajuan.harga',
					'item_pengajuan.quantity'
				],
				sort: ['-date_created'],
				limit: 50
			})
		)) as any[];

		return rows.map((r) => ({
			id: r.id,
			nama_pengaju: r.nama_pengaju,
			department: r.department,
			tujuan_pengajuan: r.tujuan_pengajuan,
			urgency: r.urgency,
			stock_gate_status: r.stock_gate_status,
			total_estimasi: (r.item_pengajuan || []).reduce(
				(sum: number, it: any) => sum + (parseFloat(it.harga) || 0) * (parseFloat(it.quantity) || 0),
				0
			)
		}));
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

const APPROVAL_STAGE_KEY_MAP: Record<string, string> = {
	department_manager: 'department_manager_approved',
	inventory: 'inventory_approved',
	plant_manager: 'plant_manager_approved',
	procurement: 'procurement_approved',
	finance: 'finance_approved',
	hrd: 'hrd_approved',
	direktur: 'direktur_approved',
	general_manager: 'general_manager_approved'
};

/**
 * Approve PR di stage department_manager. Logika penentuan status berikut sengaja
 * meniru overrideApprovalStage() di erp-epi-1/procurementApi.js agar hasil status
 * konsisten antara Admin dan Mobile.
 */
export async function approvePRField(
	prId: number,
	notes: string
): Promise<{ success: boolean; error?: string }> {
	try {
		const pengajuan: any = await directus.request(readItem('pengajuan', prId, { fields: ['*'] }));

		const patchBody: Record<string, any> = {
			department_manager_approved: true,
			department_manager_rejected: false,
			approval_notes: notes || 'Disetujui dari HP (mobile)'
		};

		const approvalPath = pengajuan.approval_path;
		if (Array.isArray(approvalPath) && approvalPath.length > 0) {
			const includedStages = approvalPath.filter((s: any) => s.included);
			const allApproved = includedStages.every((s: any) => {
				if (s.stage === 'department_manager') return true;
				const key = APPROVAL_STAGE_KEY_MAP[s.stage] || `${s.stage}_approved`;
				return pengajuan[key] === true;
			});
			patchBody.status = allApproved ? 'Fully Approved' : 'Partially Approved';
		} else {
			const otherFields = [
				'inventory_approved',
				'hrd_approved',
				'finance_approved',
				'direktur_approved',
				'general_manager_approved',
				'produksi_approved',
				'it_approved',
				'plant_manager_approved'
			];
			const anyOtherPending = otherFields.some((f) => pengajuan[f] === false);
			patchBody.status = anyOtherPending ? 'Partially Approved' : 'Fully Approved';
		}

		await directus.request(updateItem('pengajuan', prId, patchBody));
		return { success: true };
	} catch (error) {
		handleDirectusError(error);
		return { success: false, error: (error as any)?.message || 'Gagal approve' };
	}
}

export async function rejectPRField(
	prId: number,
	reason: string
): Promise<{ success: boolean; error?: string }> {
	try {
		await directus.request(
			updateItem('pengajuan', prId, {
				department_manager_rejected: true,
				rejected_stage: 'department_manager',
				reject_reason: reason || 'Ditolak dari HP (mobile)',
				status: 'Rejected'
			})
		);
		return { success: true };
	} catch (error) {
		handleDirectusError(error);
		return { success: false, error: (error as any)?.message || 'Gagal reject' };
	}
}

export interface POTrackingItem {
	id: number;
	po_number: string;
	po_date: string;
	supplier_name: string;
	status: string;
	total_amount: number;
	delivery_date: string | null;
	// Rantai Bahan SPK v2, Fase 4.2 (2 Sep 2026) — asal ETA + termin bayar untuk mini-stepper.
	eta_source?: 'supplier' | 'estimasi_leadtime' | 'warisan' | null;
	payment_terms?: string | null;
	// Lifecycle Pembelian v2, Fase 3 (leg transit) — read-only di lapangan, diisi admin ERP
	// lewat ShippingTracker.svelte. Field baru, PO lama akan null sampai admin mengisinya.
	supplier_confirmed_at?: string | null;
	shipping_provider?: string | null;
	shipping_tracking_no?: string | null;
}

export async function fetchPOTracking(search?: string): Promise<POTrackingItem[]> {
	try {
		const filter: any = search
			? { _or: [{ po_number: { _icontains: search } }, { supplier_name: { _icontains: search } }] }
			: {};
		const rows = (await directus.request(
			readItems('purchase_orders_supplier', {
				filter,
				fields: [
					'id', 'po_number', 'po_date', 'supplier_name', 'status', 'total_amount', 'delivery_date', 'eta_source', 'payment_terms',
					'supplier_confirmed_at', 'shipping_provider', 'shipping_tracking_no'
				],
				sort: ['-po_date'],
				limit: 50
			})
		)) as any[];
		return rows as POTrackingItem[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export interface POTrackingLineItem {
	id: number;
	item_name: string;
	quantity: number;
	received_qty: number;
	unit: string | null;
}

/**
 * Rantai Bahan SPK v2, Fase 4.2 (2 Sep 2026) — progres per item untuk mini-stepper di
 * kartu PO yang dibuka (Lacak Pesanan). Baca langsung Directus (data mentah PO, bukan
 * hasil komputasi rantai) -- tidak perlu lintas-origin ke erp-epi untuk ini.
 */
export async function fetchPOTrackingItems(poId: number): Promise<POTrackingLineItem[]> {
	try {
		const rows = (await directus.request(
			readItems('purchase_order_supplier_items' as any, {
				filter: { po_id: { _eq: poId } } as any,
				fields: ['id', 'item_name', 'quantity', 'received_qty', 'unit'],
				limit: -1
			})
		)) as any[];
		return rows as POTrackingLineItem[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export interface POTrackingGrn {
	status: string | null;
}
export interface POTrackingReturn {
	status: string | null;
}

/**
 * Lifecycle Pembelian v2, Fase 2 — fakta GRN + retur untuk kartu PO yang di-expand.
 * Fetching dipisah per relasi (Aturan #2), dipanggil hanya saat kartu dibuka (hemat API).
 * Invoice/Settlement (F6-F7) SENGAJA tidak diambil di sini — belum ada keputusan Lead (Q5)
 * apakah info pembayaran boleh terlihat di HP lapangan, jadi F6/F7 tidak dirender di lacak.
 */
export async function fetchPOTrackingLifecycleFacts(poId: number): Promise<{ grns: POTrackingGrn[]; returns: POTrackingReturn[] }> {
	try {
		const [grns, returns] = await Promise.all([
			directus.request(
				readItems('goods_receipt_notes' as any, {
					filter: { po_id: { _eq: poId } } as any,
					fields: ['status'],
					limit: -1
				})
			) as Promise<any[]>,
			directus.request(
				readItems('purchase_returns' as any, {
					filter: { po_id: { _eq: poId } } as any,
					fields: ['status'],
					limit: -1
				})
			) as Promise<any[]>
		]);
		return { grns: grns as POTrackingGrn[], returns: returns as POTrackingReturn[] };
	} catch (error) {
		handleDirectusError(error);
		return { grns: [], returns: [] };
	}
}

export interface POItemForConfirmation {
	id: number;
	item_name: string;
	quantity: number;
	unit: string;
	received_qty: number;
}

// Lifecycle Pembelian v2, Fase 4 — kondisi barang saat inspeksi lapangan. Nilainya
// selaras dengan choices `goods_receipt_note_items.reject_reason` di erp-epi (kecuali
// 'baik', yang berarti tidak ada reject sama sekali).
export type KondisiBarangDilaporkan = 'baik' | 'rusak' | 'salah_spec' | 'kurang' | 'expired' | 'lainnya';

export async function fetchPODetailForConfirmation(
	poId: number
): Promise<{ po: any; items: POItemForConfirmation[] }> {
	try {
		const po = await directus.request(readItem('purchase_orders_supplier', poId, { fields: ['*'] }));
		const items = (await directus.request(
			readItems('purchase_order_supplier_items', {
				filter: { po_id: { _eq: poId } },
				fields: ['id', 'item_name', 'quantity', 'unit', 'received_qty'],
				limit: -1
			})
		)) as any[];
		return { po, items: items as POItemForConfirmation[] };
	} catch (error) {
		handleDirectusError(error);
		return { po: null, items: [] };
	}
}

/**
 * Kirim konfirmasi terima barang dari lapangan (bukti foto + qty yang dilaporkan).
 * Ini HANYA audit/bukti — Admin tetap yang memfinalisasi received_qty/stok/jurnal
 * lewat DaftarPO seperti biasa, untuk hindari duplikasi stok lintas codebase.
 */
export async function submitFieldConfirmation(params: {
	poId: number;
	karyawanId: number | null;
	namaKaryawan: string;
	items: {
		po_item_id: number;
		item_name: string;
		qty_dilaporkan: number;
		// Fase 4 — kosong/0 berarti seluruh qty_dilaporkan kondisinya baik (tidak reject apa pun).
		qty_reject?: number;
		kondisi?: KondisiBarangDilaporkan;
	}[];
	fotoFileId: string | null;
	catatan: string;
}): Promise<{ success: boolean; error?: string }> {
	try {
		await directus.request(
			createItem('po_field_confirmations', {
				po_id: params.poId,
				karyawan_id: params.karyawanId,
				nama_karyawan: params.namaKaryawan,
				items_dilaporkan: params.items,
				foto: params.fotoFileId,
				catatan: params.catatan,
				status: 'menunggu_verifikasi'
			})
		);
		return { success: true };
	} catch (error) {
		handleDirectusError(error);
		return { success: false, error: (error as any)?.message || 'Gagal mengirim konfirmasi' };
	}
}

// Fase 6 (Audit AR/AP v2, AP9) — status pembayaran PO COD dari purchase_invoices
// (payment_status), BUKAN finance_processed. Read-only.
export type CodPayStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'NONE';

export async function fetchPOCodPaymentStatus(poIds: number[]): Promise<Record<number, CodPayStatus>> {
	const out: Record<number, CodPayStatus> = {};
	const ids = [...new Set((poIds || []).filter((n) => Number.isFinite(n)))];
	if (ids.length === 0) return out;
	for (const id of ids) out[id] = 'NONE';
	try {
		for (let i = 0; i < ids.length; i += 100) {
			const chunk = ids.slice(i, i + 100);
			const rows = (await directus.request(
				readItems('purchase_invoices', {
					filter: { payable_type: { _eq: 'PURCHASE_ORDER' }, supplier_po_id: { _in: chunk } },
					fields: ['supplier_po_id', 'payment_status'],
					limit: -1
				})
			)) as any[];
			const byPo: Record<number, string[]> = {};
			for (const r of rows) {
				const pid = Number(r.supplier_po_id);
				(byPo[pid] ||= []).push(String(r.payment_status || 'UNPAID'));
			}
			for (const [pid, statuses] of Object.entries(byPo)) {
				const arr = statuses as string[];
				out[Number(pid)] = arr.every((x) => x === 'PAID')
					? 'PAID'
					: arr.some((x) => x === 'PAID' || x === 'PARTIAL')
						? 'PARTIAL'
						: 'UNPAID';
			}
		}
	} catch (error) {
		handleDirectusError(error);
	}
	return out;
}


export interface ProjectProcurementItem {
	id: number;
	pr_number: string;
	status: string;
	status_label: string;
	badge_class: string;
	nama_pengaju: string;
	tujuan: string;
	kategori_pembelian: string;
	date_created: string;
	is_non_stock: boolean;
	total_amount: number;
	received_amount: number;
	items: Array<{
		id: number;
		nama_barang: string;
		quantity: number;
		units: string;
		harga: number;
		status?: string;
	}>;
	pos: Array<{
		id: number;
		po_number: string;
		po_date: string;
		supplier_name: string;
		status: string;
		total_amount: number;
		sent_at: string | null;
		items: Array<{
			id: number;
			item_name: string;
			quantity: number;
			unit: string;
			unit_price: number;
			received_qty: number;
		}>;
	}>;
}

export function buildProjectProcurementList({
	prRows = [],
	prItems = [],
	poRows = [],
	poItems = []
}: {
	prRows?: any[];
	prItems?: any[];
	poRows?: any[];
	poItems?: any[];
}): ProjectProcurementItem[] {
	const itemsByPr = new Map<number, any[]>();
	for (const it of prItems || []) {
		const rid = Number(it.request_id);
		if (rid) {
			if (!itemsByPr.has(rid)) itemsByPr.set(rid, []);
			itemsByPr.get(rid)!.push(it);
		}
	}

	const itemsByPo = new Map<number, any[]>();
	for (const poi of poItems || []) {
		const pId = Number(poi.po_id);
		if (pId) {
			if (!itemsByPo.has(pId)) itemsByPo.set(pId, []);
			itemsByPo.get(pId)!.push(poi);
		}
	}

	const posByPr = new Map<number, any[]>();
	for (const po of poRows || []) {
		const prId = Number(po.pengajuan_id);
		if (prId) {
			if (!posByPr.has(prId)) posByPr.set(prId, []);
			const pLines = itemsByPo.get(Number(po.id)) || [];
			posByPr.get(prId)!.push({
				...po,
				items: pLines
			});
		}
	}

	return (prRows || []).map((pr) => {
		const pItems = itemsByPr.get(Number(pr.id)) || [];
		const totalAmount = pItems.reduce(
			(sum, it) => sum + (parseFloat(it.harga) || 0) * (parseFloat(it.quantity) || 0),
			0
		);

		const linkedPos = posByPr.get(Number(pr.id)) || [];

		let receivedAmount = 0;
		for (const po of linkedPos) {
			for (const pi of po.items || []) {
				const rec = parseFloat(pi.received_qty) || 0;
				if (rec > 0) {
					receivedAmount += rec * (parseFloat(pi.unit_price) || 0);
				}
			}
		}

		let statusLabel = pr.status || 'Diajukan';
		let badgeClass = 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800';

		if (linkedPos.length > 0) {
			const po = linkedPos[0];
			const poStatus = String(po.status || '').toLowerCase();
			if (poStatus === 'draft') {
				statusLabel = `PO Draft (${po.po_number || 'PO'})`;
				badgeClass = 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800';
			} else if (poStatus === 'sent') {
				statusLabel = `PO Terkirim (${po.po_number || 'PO'})`;
				badgeClass = 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800';
			} else if (poStatus === 'partial_received') {
				statusLabel = `Diterima Sebagian (${po.po_number || 'PO'})`;
				badgeClass = 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800';
			} else if (poStatus === 'received' || poStatus === 'completed' || poStatus === 'closed') {
				statusLabel = `Selesai / Diterima (${po.po_number || 'PO'})`;
				badgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800';
			}
		} else {
			const stLower = String(pr.status || '').toLowerCase();
			if (stLower.includes('reject') || stLower.includes('tolak')) {
				statusLabel = 'Ditolak';
				badgeClass = 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800';
			} else if (stLower.includes('approv') || stLower.includes('setuju')) {
				statusLabel = 'Disetujui — Menunggu PO';
				badgeClass = 'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800';
			}
		}

		return {
			id: pr.id,
			pr_number: pr.nomor_pengajuan || `PR-#${pr.id}`,
			status: pr.status,
			status_label: statusLabel,
			badge_class: badgeClass,
			nama_pengaju: pr.nama_pengaju,
			tujuan: pr.tujuan_pengajuan,
			kategori_pembelian: pr.kategori_pembelian,
			date_created: pr.date_created,
			is_non_stock: pr.is_non_stock,
			total_amount: totalAmount,
			received_amount: receivedAmount,
			items: pItems,
			pos: linkedPos
		};
	});
}

export async function fetchProjectProcurementHistory(projectId: number | string): Promise<ProjectProcurementItem[]> {
	const pid = Number(projectId);
	if (!Number.isSafeInteger(pid) || pid <= 0) return [];
	try {
		const prRows = (await directus.request(
			readItems('pengajuan', {
				filter: { project_id: { _eq: pid } },
				fields: [
					'id', 'nomor_pengajuan', 'status', 'nama_pengaju',
					'tujuan_pengajuan', 'kategori_pembelian', 'date_created',
					'urgency', 'is_non_stock'
				],
				sort: ['-date_created'],
				limit: 100
			})
		)) as any[];

		if (!prRows || prRows.length === 0) return [];
		const prIds = prRows.map((p) => p.id).filter(Boolean);

		const prItems = (await directus.request(
			readItems('items_pengajuan', {
				filter: { request_id: { _in: prIds } },
				fields: ['id', 'request_id', 'nama_barang', 'quantity', 'units', 'harga', 'status', 'kategori_item'],
				limit: -1
			})
		)) as any[];

		const poRows = (await directus.request(
			readItems('purchase_orders_supplier', {
				filter: { pengajuan_id: { _in: prIds } },
				fields: ['id', 'po_number', 'po_date', 'supplier_name', 'status', 'total_amount', 'pengajuan_id', 'sent_at', 'delivery_date'],
				limit: -1
			})
		)) as any[];

		const poIds = poRows.map((p) => p.id).filter(Boolean);
		let poItems: any[] = [];
		if (poIds.length > 0) {
			poItems = (await directus.request(
				readItems('purchase_order_supplier_items' as any, {
					filter: { po_id: { _in: poIds } } as any,
					fields: ['id', 'po_id', 'item_name', 'quantity', 'unit', 'unit_price', 'total_price', 'received_qty'],
					limit: -1
				})
			)) as any[];
		}

		return buildProjectProcurementList({ prRows, prItems, poRows, poItems });
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}
