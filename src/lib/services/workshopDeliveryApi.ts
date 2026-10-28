// src/lib/services/workshopDeliveryApi.ts
// Fase 5a — Tracking pengiriman Workshop (Ciketing & Balaraja) untuk dashboard lapangan.
// READ-ONLY: Project Leader hanya MELIHAT status SJ Keluar + invoice proyeknya. Tidak ada
// tulisan ke collection workshop (keputusan K3). Tombol "Minta Pengiriman" di UI cukup
// membuka WhatsApp dengan pesan terisi — nol backend, nol DB write.
//
// Semua baca lewat client Directus terautentikasi (proxy Firebase, sama pola fieldReport.ts).

import directus, { handleDirectusError } from './directus';
import { readItems } from '@directus/sdk';
import { getProjectScope, getProjectsForCurrentUser } from './projectScope';

export type WorkshopKind = 'ciketing' | 'balaraja';

const COLLECTION: Record<WorkshopKind, string> = {
	ciketing: 'ciketing_surat_jalan_keluar',
	balaraja: 'balaraja_surat_jalan_keluar'
};

const SJ_FIELDS = [
	'id', 'no_sj', 'tanggal', 'nama_barang', 'qty', 'satuan', 'luasan_m2',
	'so_detail_id', 'no_part', 'harga_satuan', 'total_harga',
	'approval_status', 'approved_by', 'approved_at', 'catatan_finance',
	'project', 'item', 'invoice_id', 'invoiced_at', 'qr_token', 'pic', 'status_kirim'
];

export interface WsDeliveryItem {
	id: number;
	nama_barang: string;
	no_part: string | null;
	qty: number;
	satuan: string;
	luasan_m2: number;
	harga_satuan: number;
	total_harga: number;
	approval_status: string;
	approved_by: string | null;
	approved_at: string | null;
	catatan_finance: string | null;
}

export interface WsDeliveryInvoice {
	id: number;
	invoice_number: string;
	invoice_date: string | null;
	due_date: string | null;
	total_amount: number;
	outstanding_amount: number;
	payment_status: string;
	is_partial: boolean | null;
	delivery_sequence: number | null;
}

/** Rantai status "jujur" yang dilihat lapangan. */
export type WsDeliveryStage =
	| 'menunggu'      // Menunggu Approval Finance
	| 'ditahan'       // Ditahan Finance (ada alasan)
	| 'disetujui'     // Disetujui, barang boleh keluar
	| 'invoice'       // Invoice sudah terbit
	| 'lunas'         // Invoice lunas
	| 'campur';       // batch bercampur status

export interface WsDeliveryBatch {
	key: string;
	workshop: WorkshopKind;
	no_sj: string;
	tanggal: string | null;
	project_id: number | null;
	project_name: string;
	item_count: number;
	qty_total: number;
	nilai_total: number;
	stage: WsDeliveryStage;
	hold_reason: string | null;
	invoice: WsDeliveryInvoice | null;
}

function num(v: any): number {
	const n = parseFloat(v);
	return Number.isFinite(n) ? n : 0;
}

function batchKey(r: any): string {
	if (r.no_sj) return r.no_sj;
	if (r.qr_token && String(r.qr_token).startsWith('batch-')) return 'batch-' + String(r.qr_token).split('-')[1];
	return 'id-' + r.id;
}

function projId(r: any): number | null {
	const p = typeof r.project === 'object' ? r.project?.id : r.project;
	return p ? Number(p) : null;
}

async function loadRows(workshop: WorkshopKind, projectIds: number[] | null): Promise<any[]> {
	const filter: any = {};
	if (projectIds && projectIds.length > 0) filter.project = { _in: projectIds };
	try {
		return (await directus.request(
			readItems(COLLECTION[workshop] as any, {
				filter,
				fields: SJ_FIELDS as any,
				sort: ['-tanggal'] as any,
				limit: projectIds ? -1 : 300
			})
		)) as any[];
	} catch {
		return []; // koleksi mungkin belum diberi izin baca untuk role lapangan
	}
}

async function loadInvoices(ids: number[]): Promise<Map<number, WsDeliveryInvoice>> {
	const map = new Map<number, WsDeliveryInvoice>();
	if (ids.length === 0) return map;
	try {
		const rows = (await directus.request(
			readItems('invoices' as any, {
				filter: { id: { _in: ids } },
				fields: ['id', 'invoice_number', 'invoice_date', 'due_date', 'total_amount', 'outstanding_amount', 'payment_status', 'is_partial', 'delivery_sequence'] as any,
				limit: -1
			})
		)) as any[];
		for (const inv of rows) {
			map.set(inv.id, {
				id: inv.id,
				invoice_number: inv.invoice_number,
				invoice_date: inv.invoice_date ?? null,
				due_date: inv.due_date ?? null,
				total_amount: num(inv.total_amount),
				outstanding_amount: num(inv.outstanding_amount),
				payment_status: inv.payment_status ?? 'UNPAID',
				is_partial: inv.is_partial ?? null,
				delivery_sequence: inv.delivery_sequence ?? null
			});
		}
	} catch { /* biarkan kosong */ }
	return map;
}

async function loadProjectNames(ids: number[]): Promise<Map<number, string>> {
	const map = new Map<number, string>();
	if (ids.length === 0) return map;
	try {
		const rows = (await directus.request(
			readItems('projects' as any, { filter: { id: { _in: ids } }, fields: ['id', 'name', 'nomor_po'] as any, limit: -1 })
		)) as any[];
		for (const p of rows) map.set(p.id, p.name || p.nomor_po || `Proyek #${p.id}`);
	} catch { /* biarkan kosong */ }
	return map;
}

function deriveStage(statuses: string[], invoice: WsDeliveryInvoice | null): { stage: WsDeliveryStage } {
	const uniq = [...new Set(statuses.map((s) => s || 'menunggu'))];
	if (invoice) {
		if (String(invoice.payment_status).toUpperCase() === 'PAID') return { stage: 'lunas' };
		return { stage: 'invoice' };
	}
	if (uniq.length > 1) return { stage: 'campur' };
	const s = uniq[0];
	if (s === 'approved') return { stage: 'disetujui' };
	if (s === 'rejected') return { stage: 'ditahan' };
	return { stage: 'menunggu' };
}

function groupBatches(
	rows: any[],
	workshop: WorkshopKind,
	invoices: Map<number, WsDeliveryInvoice>,
	projectNames: Map<number, string>
): WsDeliveryBatch[] {
	const byKey = new Map<string, any[]>();
	for (const r of rows) {
		const k = batchKey(r);
		if (!byKey.has(k)) byKey.set(k, []);
		byKey.get(k)!.push(r);
	}
	const out: WsDeliveryBatch[] = [];
	for (const [key, items] of byKey) {
		const first = items[0];
		const pid = projId(first);
		const invId = items.map((i) => i.invoice_id).find(Boolean) || null;
		const invoice = invId ? invoices.get(Number(invId)) || null : null;
		const statuses = items.map((i) => i.approval_status);
		const { stage } = deriveStage(statuses, invoice);
		const holdRow = items.find((i) => i.approval_status === 'rejected' && i.catatan_finance);
		out.push({
			key,
			workshop,
			no_sj: first.no_sj || key,
			tanggal: first.tanggal ?? null,
			project_id: pid,
			project_name: pid ? projectNames.get(pid) || `Proyek #${pid}` : '—',
			item_count: items.length,
			qty_total: items.reduce((s, i) => s + num(i.qty), 0),
			nilai_total: items.reduce((s, i) => s + (num(i.total_harga) || num(i.qty) * num(i.harga_satuan)), 0),
			stage,
			hold_reason: holdRow?.catatan_finance || (stage === 'ditahan' ? 'Ditahan Finance (alasan tidak tercatat)' : null),
			invoice
		});
	}
	return out.sort((a, b) => String(b.tanggal || '').localeCompare(String(a.tanggal || '')));
}

/** Daftar batch pengiriman workshop untuk proyek yang dipegang pengguna. */
export async function fetchMyWorkshopDeliveries(): Promise<WsDeliveryBatch[]> {
	try {
		const scope = getProjectScope();
		let projectIds: number[] | null = null;
		if (!scope.unrestricted) {
			if (scope.kosong) return [];
			const projects = await getProjectsForCurrentUser(false);
			projectIds = (projects || []).map((p: any) => Number(p.id)).filter(Boolean);
			if (projectIds.length === 0) return [];
		}

		const [cik, blr] = await Promise.all([loadRows('ciketing', projectIds), loadRows('balaraja', projectIds)]);
		const allRows = [
			...cik.map((r) => ({ r, w: 'ciketing' as WorkshopKind })),
			...blr.map((r) => ({ r, w: 'balaraja' as WorkshopKind }))
		];

		const invIds = [...new Set(allRows.map(({ r }) => r.invoice_id).filter(Boolean).map(Number))];
		const pids = [...new Set(allRows.map(({ r }) => projId(r)).filter(Boolean) as number[])];
		const [invoices, projectNames] = await Promise.all([loadInvoices(invIds), loadProjectNames(pids)]);

		return [
			...groupBatches(cik, 'ciketing', invoices, projectNames),
			...groupBatches(blr, 'balaraja', invoices, projectNames)
		].sort((a, b) => String(b.tanggal || '').localeCompare(String(a.tanggal || '')));
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export interface WsDeliveryDetail {
	batch: WsDeliveryBatch;
	items: WsDeliveryItem[];
}

/** Detail satu batch (semua item ber-no_sj sama) + invoice. */
export async function fetchWorkshopDeliveryDetail(workshop: WorkshopKind, key: string): Promise<WsDeliveryDetail | null> {
	try {
		let effectiveKey = key;
		// Key dari scan QR = "id-<baris>". Naikkan ke no_sj batch-nya bila ada.
		if (key.startsWith('id-')) {
			const one = (await directus.request(
				readItems(COLLECTION[workshop] as any, { filter: { id: { _eq: Number(key.slice(3)) } }, fields: ['no_sj', 'qr_token'] as any, limit: 1 })
			)) as any[];
			if (one?.[0]?.no_sj) effectiveKey = one[0].no_sj;
			else if (one?.[0]?.qr_token && String(one[0].qr_token).startsWith('batch-')) effectiveKey = 'batch-' + String(one[0].qr_token).split('-')[1];
		}

		const isBatchToken = effectiveKey.startsWith('batch-');
		const isIdKey = effectiveKey.startsWith('id-');
		const filter: any = isBatchToken
			? { qr_token: { _starts_with: effectiveKey + '-' } }
			: isIdKey
				? { id: { _eq: Number(effectiveKey.slice(3)) } }
				: { no_sj: { _eq: effectiveKey } };

		const rows = (await directus.request(
			readItems(COLLECTION[workshop] as any, { filter, fields: SJ_FIELDS as any, sort: ['id'] as any, limit: -1 })
		)) as any[];
		if (!rows || rows.length === 0) return null;

		const invId = rows.map((r) => r.invoice_id).find(Boolean) || null;
		const pid = projId(rows[0]);
		const [invoices, projectNames] = await Promise.all([
			loadInvoices(invId ? [Number(invId)] : []),
			loadProjectNames(pid ? [pid] : [])
		]);
		const [batch] = groupBatches(rows, workshop, invoices, projectNames);

		const items: WsDeliveryItem[] = rows.map((r) => ({
			id: r.id,
			nama_barang: r.nama_barang || '-',
			no_part: r.no_part ?? null,
			qty: num(r.qty),
			satuan: r.satuan || '',
			luasan_m2: num(r.luasan_m2),
			harga_satuan: num(r.harga_satuan),
			total_harga: num(r.total_harga) || num(r.qty) * num(r.harga_satuan),
			approval_status: r.approval_status || 'menunggu',
			approved_by: r.approved_by ?? null,
			approved_at: r.approved_at ?? null,
			catatan_finance: r.catatan_finance ?? null
		}));

		return { batch, items };
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export interface WsDeliveryProgressLine {
	so_detail_id: number;
	nama_barang: string;
	satuan: string;
	qty_po: number;
	qty_terkirim: number;
	sisa_qty: number;
	nilai_po: number;
	nilai_terkirim: number;
	sisa_nilai: number;
}

/** Progres pengiriman parsial per item PO (read-only mirror dari workshopDelivery.js erp-epi-1). */
export async function fetchWorkshopDeliveryProgress(
	projectId: number,
	workshop: WorkshopKind
): Promise<WsDeliveryProgressLine[]> {
	try {
		const proj = (await directus.request(
			readItems('projects' as any, { filter: { id: { _eq: projectId } }, fields: ['id', 'so_customer_id'] as any, limit: 1 })
		)) as any[];
		const soId = typeof proj?.[0]?.so_customer_id === 'object' ? proj?.[0]?.so_customer_id?.id : proj?.[0]?.so_customer_id;
		if (!soId) return [];

		const [details, sjRows] = await Promise.all([
			directus.request(readItems('so_customer_details' as any, {
				filter: { so_customer_id: { _eq: soId } },
				fields: ['id', 'nama_barang', 'qty', 'harga_satuan', 'total', 'item_id.nama_barang_lengkap', 'item_id.satuan'] as any,
				limit: -1
			})) as Promise<any[]>,
			directus.request(readItems(COLLECTION[workshop] as any, {
				filter: { project: { _eq: projectId }, approval_status: { _neq: 'rejected' } },
				fields: ['so_detail_id', 'qty', 'luasan_m2', 'harga_satuan', 'total_harga'] as any,
				limit: -1
			})) as Promise<any[]>
		]);

		const shipped = new Map<string, { qty: number; nilai: number }>();
		for (const s of sjRows || []) {
			const d = typeof s.so_detail_id === 'object' ? s.so_detail_id?.id : s.so_detail_id;
			if (d == null) continue;
			const cur = shipped.get(String(d)) || { qty: 0, nilai: 0 };
			cur.qty += num(s.qty);
			cur.nilai += num(s.total_harga) || (num(s.luasan_m2) > 0 ? num(s.luasan_m2) : num(s.qty)) * num(s.harga_satuan);
			shipped.set(String(d), cur);
		}

		return (details || []).map((d) => {
			const qtyPo = num(d.qty);
			const hargaPo = num(d.harga_satuan);
			const nilaiPo = num(d.total) || qtyPo * hargaPo;
			const sh = shipped.get(String(d.id)) || { qty: 0, nilai: 0 };
			return {
				so_detail_id: d.id,
				nama_barang: d.nama_barang || d.item_id?.nama_barang_lengkap || '(Tanpa Nama)',
				satuan: d.item_id?.satuan || '',
				qty_po: qtyPo,
				qty_terkirim: sh.qty,
				sisa_qty: qtyPo - sh.qty,
				nilai_po: nilaiPo,
				nilai_terkirim: sh.nilai,
				sisa_nilai: nilaiPo - sh.nilai
			};
		});
	} catch {
		return [];
	}
}

export const STAGE_LABEL: Record<WsDeliveryStage, string> = {
	menunggu: 'Menunggu Approval Finance',
	ditahan: 'Ditahan Finance',
	disetujui: 'Disetujui — barang boleh keluar',
	invoice: 'Invoice Terbit',
	lunas: 'Lunas',
	campur: 'Status Campur'
};

export const STAGE_COLOR: Record<WsDeliveryStage, string> = {
	menunggu: 'bg-amber-100 text-amber-800',
	ditahan: 'bg-red-100 text-red-800',
	disetujui: 'bg-blue-100 text-blue-800',
	invoice: 'bg-indigo-100 text-indigo-800',
	lunas: 'bg-emerald-100 text-emerald-800',
	campur: 'bg-slate-100 text-slate-600'
};
