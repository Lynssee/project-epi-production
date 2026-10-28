// src/lib/server/reportUrgentPacking.ts
// SERVER-ONLY. Pengganti Directus Flow "Field Report: Flow B - Auto Packing Request (Urgent)".
//
// Flow B lama meng-INSERT project_budgets ('requested') langsung via SQL dari reports.material_needs:
// melewati gate G_PKL_PROJECT (proyek closed/cancelled), approval engine, dan validasi qty
// (Number(amount) || 0 menerima 0/negatif); tanpa dedupe; item tanpa tautan barang dibuang diam-diam.
// Di sini kebutuhan ber-urgensi "urgent" diajukan lewat jalur server yang sama dengan form packing
// (createPackingItemsRequest: gate + batch + approval + rollback), dipicu dari
// /api/laporan/notify-submitted setelah laporan tersimpan.
//
// Aturan:
//  - Data dibaca ulang dari Directus (tidak percaya payload klien) — query terpisah, tanpa relasi bersarang.
//  - Hanya pengirim laporan (reports.karyawan_id) yang boleh memicu pengajuan.
//  - Idempoten: tiap item membawa penanda {ref:laporan:<id>:<idx>} di project_budgets.note; pemanggilan
//    ulang (laporan dikirim ulang) tidak membuat baris dobel.
//  - Item tanpa tautan barang master TETAP diajukan (gate G_PKL_INVENTORY_LINK hanya peringatan).
//  - Fail-soft: tidak pernah melempar ke pemanggil; hasilnya dikembalikan sebagai objek.

import { directusServerJson } from './directus';
import { createPackingItemsRequest, type NewPackingItem } from './packingListCreateItems';

export const MAX_URGENT_ITEMS = 20;
export const MAX_URGENT_QTY = 1_000_000;

export type SkipReason =
	| 'bukan_objek'
	| 'tanpa_nama'
	| 'qty_tidak_valid'
	| 'qty_tidak_wajar'
	| 'melebihi_batas'
	| 'sudah_diajukan';

export interface UrgentItem extends NewPackingItem {
	note: string;
	_ref: string;
	_index: number;
}

export interface PickResult {
	items: UrgentItem[];
	skipped: Array<{ index: number; reason: SkipReason }>;
}

/** Penanda unik per item laporan. Kurung kurawal penutup mencegah ':1' cocok dengan ':10'. */
export const refOf = (reportId: number | string, index: number) => `{ref:laporan:${reportId}:${index}}`;

function parseNeeds(raw: unknown): unknown[] {
	if (Array.isArray(raw)) return raw;
	if (typeof raw === 'string' && raw.trim()) {
		try {
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}
	return [];
}

const isUrgent = (n: any) => n?.urgency === 'urgent' || n?.is_urgent === true || n?.priority === 'urgent';

/** Murni: pilih kebutuhan urgent yang valid dari reports.material_needs. */
export function pickUrgentNeeds(rawNeeds: unknown, reportId: number | string): PickResult {
	const items: UrgentItem[] = [];
	const skipped: PickResult['skipped'] = [];
	parseNeeds(rawNeeds).forEach((need: any, index) => {
		if (!need || typeof need !== 'object') {
			skipped.push({ index, reason: 'bukan_objek' });
			return;
		}
		if (!isUrgent(need)) return; // kebutuhan normal memang bukan urusan jalur ini
		const name = String(need.type || need.description || '').trim();
		if (!name) {
			skipped.push({ index, reason: 'tanpa_nama' });
			return;
		}
		const qty = Number(need.amount);
		if (!Number.isFinite(qty) || qty <= 0) {
			skipped.push({ index, reason: 'qty_tidak_valid' });
			return;
		}
		if (qty > MAX_URGENT_QTY) {
			skipped.push({ index, reason: 'qty_tidak_wajar' });
			return;
		}
		if (items.length >= MAX_URGENT_ITEMS) {
			skipped.push({ index, reason: 'melebihi_batas' });
			return;
		}
		const idb = Number(need.identitas_barang_id);
		const ref = refOf(reportId, index);
		items.push({
			material_name: name,
			qty,
			unit: String(need.unit || '').trim() || 'pcs',
			description: String(need.notes || '').trim() || name,
			identitas_barang_id: Number.isFinite(idb) && idb > 0 ? idb : null,
			note: `Auto-generated dari Laporan Harian #${reportId} (kebutuhan urgent) ${ref}`,
			_ref: ref,
			_index: index
		});
	});
	return { items, skipped };
}

export interface Actor {
	karyawanId: number;
	nama?: string | null;
	divisi?: string | null;
	firebaseUid?: string;
	overrideAllowed?: boolean;
}

export interface UrgentPackingResult {
	created: number;
	itemIds?: Array<number | string>;
	approvalRequestId?: string | null;
	skipped?: PickResult['skipped'];
	reason?:
		| 'laporan_tidak_ditemukan'
		| 'bukan_pengirim_laporan'
		| 'laporan_tanpa_pengirim'
		| 'laporan_ditolak'
		| 'tidak_ada_kebutuhan_urgent'
		| 'semua_sudah_diajukan'
		| 'proyek_tidak_valid';
	error?: string;
}

export interface Deps {
	directus: (path: string, init?: any) => Promise<any>;
	create: typeof createPackingItemsRequest;
}

const defaultDeps: Deps = { directus: directusServerJson, create: createPackingItemsRequest };

export async function createUrgentPackingFromReport(
	reportId: number | string,
	actor: Actor,
	deps: Deps = defaultDeps
): Promise<UrgentPackingResult> {
	try {
		const res: any = await deps.directus(
			`/items/reports/${encodeURIComponent(String(reportId))}?fields=id,project_id,karyawan_id,status,material_needs`
		);
		const report = res?.data;
		if (!report) return { created: 0, reason: 'laporan_tidak_ditemukan' };
		if (report.karyawan_id == null) return { created: 0, reason: 'laporan_tanpa_pengirim' };
		if (Number(report.karyawan_id) !== Number(actor.karyawanId)) return { created: 0, reason: 'bukan_pengirim_laporan' };
		if (String(report.status || '').toLowerCase() === 'rejected') return { created: 0, reason: 'laporan_ditolak' };

		const projectId = Number(typeof report.project_id === 'object' ? report.project_id?.id : report.project_id);
		if (!Number.isFinite(projectId) || projectId <= 0) return { created: 0, reason: 'proyek_tidak_valid' };

		const picked = pickUrgentNeeds(report.material_needs, report.id);
		if (picked.items.length === 0) {
			return { created: 0, skipped: picked.skipped, reason: 'tidak_ada_kebutuhan_urgent' };
		}

		// Dedupe: satu query untuk semua baris yang sudah dibuat dari laporan ini (query terpisah, tanpa relasi).
		const existingRes: any = await deps.directus(
			`/items/project_budgets?filter[note][_contains]=${encodeURIComponent(`{ref:laporan:${report.id}:`)}&fields=id,note&limit=-1`
		);
		const existingNotes: string[] = (existingRes?.data || []).map((r: any) => String(r?.note || ''));
		const skipped = [...picked.skipped];
		const fresh = picked.items.filter((it) => {
			const dup = existingNotes.some((n) => n.includes(it._ref));
			if (dup) skipped.push({ index: it._index, reason: 'sudah_diajukan' });
			return !dup;
		});
		if (fresh.length === 0) return { created: 0, skipped, reason: 'semua_sudah_diajukan' };

		const out = await deps.create({
			projectId,
			requesterId: actor.karyawanId,
			pic: actor.nama || 'Leader',
			departmentKey: actor.divisi || null,
			items: fresh.map(({ _ref, _index, ...it }) => it),
			overrideAllowed: !!actor.overrideAllowed,
			firebaseUid: actor.firebaseUid
		});
		return { created: out.itemIds.length, itemIds: out.itemIds, approvalRequestId: out.approvalRequestId, skipped };
	} catch (e: any) {
		console.error('[reportUrgentPacking] gagal membuat pengajuan dari laporan', reportId, e?.message || e);
		return { created: 0, error: e?.message || 'Gagal membuat pengajuan packing dari kebutuhan urgent' };
	}
}
