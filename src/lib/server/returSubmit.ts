// src/lib/server/returSubmit.ts
// RSM-02 §4.1 + RSM-03 §4.1/4.3 (24 Okt 2026) — SATU alur server untuk pengajuan retur lapangan:
//   baris packing_returns + header retur_gudang dibuat dalam satu request, idempoten lewat
//   client_submission_id, dengan jaring pengaman gate G_RTN_DOBEL (retur dobel barang yang sama).
//
// Sebelumnya klien membuat baris langsung ke Directus lalu memanggil endpoint dokumen terpisah;
// bila request kedua gagal (sinyal site) baris sudah tersimpan dan leader disuruh "ulangi" -> 40 baris
// dobel (RSM-03). Di sini bila pembuatan header gagal, baris yang baru dibuat DIBATALKAN (rollback).
//
// Kunci idempotensi disimpan sebagai penanda `[sub:<uuid>]` di retur_gudang.notes sampai kolom
// khusus `client_txn_id` disetujui & dibuat di Directus (jangan kirim kolom yang belum ada — Aturan #1).

import { getQtyTerkunciMutasi, saldoTersedia } from '$lib/server/mutasiQtyTerkunci';
import { directusServerJson } from '$lib/server/directus';
import { getFieldGateMode, type GateMode } from '$lib/server/gateEnforcement';
import { writeGateAudit } from '$lib/server/gates/gateAudit';
import { createReturDocument, type ReturDocResult } from '$lib/server/returGudangServer';

export const GATE_RTN_DOBEL = 'G_RTN_DOBEL' as const;
export const MIN_OVERRIDE_CHARS = 20;
/** Status header yang TIDAK lagi dianggap "retur aktif". */
const HEADER_INACTIVE = new Set(['batal', 'ditolak', 'diterima']);

export interface SubmitReturItem {
	material_name: string;
	material_color?: string | null;
	qty_returned: number;
	unit: string;
	condition: string;
	leader_notes?: string | null;
	reason_code?: string | null;
	item_id?: number | null;
	packing_list_id?: number | null;
	packing_list_item_id?: number | null;
}

export interface SubmitReturInput {
	projectId: number;
	items: SubmitReturItem[];
	equipmentLoanIds?: string[];
	submittedByName: string;
	submittedByKaryawanId: number | null;
	submittedByUid: string | null;
	email: string | null;
	clientSubmissionId?: string | null;
	overrideReason?: string | null;
	penerbit: 'inventory' | 'lapangan';
	sumber?: 'lapangan' | 'karantina';
	driverName?: string | null;
	driverPhone?: string | null;
	vehiclePlate?: string | null;
	expeditionName?: string | null;
	notes?: string | null;
}

export interface DobelInfo {
	itemId: number;
	materialName: string;
	existingQty: number;
	existingRowId: number;
	existingDocNo: string | null;
	balance: number | null;
	newQty: number;
}

export interface SubmitReturResult {
	doc: ReturDocResult | null;
	rowIds: number[];
	idempotent: boolean;
	dobel: DobelInfo[];
	gateMode: GateMode;
}

export class ReturSubmitError extends Error {
	status: number;
	code: string;
	dobel?: DobelInfo[];
	constructor(status: number, code: string, message: string, dobel?: DobelInfo[]) {
		super(message);
		this.status = status;
		this.code = code;
		this.dobel = dobel;
	}
}

export const subTag = (id: string) => `[sub:${id}]`;

const qs = (o: Record<string, unknown>) =>
	new URLSearchParams(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])).toString();

/** Retur aktif proyek untuk item tertentu: baris return_requested yang headernya belum batal/ditolak/diterima. */
export async function findActiveReturDuplicates(projectId: number, items: SubmitReturItem[]): Promise<DobelInfo[]> {
	const wanted = items.filter((i) => i.item_id != null);
	const ids = [...new Set(wanted.map((i) => Number(i.item_id)))];
	if (!ids.length) return [];

	// Query terpisah per koleksi (Aturan #2). Kegagalan baca dicatat jelas, bukan ditelan (Aturan #1).
	const rows = await directusServerJson<{ data: Array<{ id: number; item_id: number; qty_returned: number; retur_gudang_id: number | null }> }>(
		`/items/packing_returns?${qs({
			filter: { project_id: { _eq: projectId }, return_status: { _eq: 'return_requested' }, item_id: { _in: ids } },
			fields: 'id,item_id,qty_returned,retur_gudang_id',
			limit: '-1'
		})}`
	).then((r) => r?.data || []);
	if (!rows.length) return [];

	const headerIds = [...new Set(rows.map((r) => r.retur_gudang_id).filter((v): v is number => v != null))];
	const headers = new Map<number, { status: string; nomor_retur: string | null }>();
	if (headerIds.length) {
		const hs = await directusServerJson<{ data: Array<{ id: number; status: string; nomor_retur: string | null }> }>(
			`/items/retur_gudang?${qs({ filter: { id: { _in: headerIds } }, fields: 'id,status,nomor_retur', limit: '-1' })}`
		).then((r) => r?.data || []);
		for (const h of hs) headers.set(h.id, h);
	}
	const active = rows.filter((r) => !r.retur_gudang_id || !HEADER_INACTIVE.has(headers.get(r.retur_gudang_id)?.status || ''));
	if (!active.length) return [];

	const balRows = await directusServerJson<{ data: Array<{ item_id: number; qty_on_hand: number }> }>(
		`/items/project_stock_balance?${qs({
			filter: { project_id: { _eq: projectId }, item_id: { _in: ids } },
			fields: 'item_id,qty_on_hand',
			limit: '-1'
		})}`
	)
		.then((r) => r?.data || [])
		.catch((e) => {
			console.warn('[returSubmit] project_stock_balance tak terbaca untuk cek dobel (saldo dianggap tidak diketahui):', e?.message || e);
			return [] as Array<{ item_id: number; qty_on_hand: number }>;
		});
	const balance = new Map(balRows.map((b) => [Number(b.item_id), Number(b.qty_on_hand) || 0]));

	const out: DobelInfo[] = [];
	for (const it of wanted) {
		const itemId = Number(it.item_id);
		const mine = active.filter((r) => Number(r.item_id) === itemId);
		if (!mine.length) continue;
		const existingQty = mine.reduce((s, r) => s + (Number(r.qty_returned) || 0), 0);
		const bal = balance.has(itemId) ? (balance.get(itemId) as number) : null;
		const newQty = Number(it.qty_returned) || 0;
		// Dobel bila saldo tak diketahui, atau total (lama aktif + baru) melebihi saldo (RSM-03 §4.3).
		if (bal == null || existingQty + newQty > bal + 0.0001) {
			const first = mine[0];
			out.push({
				itemId,
				materialName: it.material_name,
				existingQty,
				existingRowId: first.id,
				existingDocNo: first.retur_gudang_id ? (headers.get(first.retur_gudang_id)?.nomor_retur ?? null) : null,
				balance: bal,
				newQty
			});
		}
	}
	return out;
}

async function loadIdempotent(projectId: number, tag: string): Promise<{ doc: ReturDocResult; rowIds: number[] } | null> {
	const found = await directusServerJson<{ data: Array<any> }>(
		`/items/retur_gudang?${qs({
			filter: { project_id: { _eq: projectId }, notes: { _contains: tag } },
			fields: 'id,nomor_retur,qr_token,status',
			limit: '1'
		})}`
	).then((r) => r?.data?.[0] || null);
	if (!found) return null;
	const rows = await directusServerJson<{ data: Array<{ id: number }> }>(
		`/items/packing_returns?${qs({ filter: { retur_gudang_id: { _eq: found.id } }, fields: 'id', sort: ['id'], limit: '-1' })}`
	).then((r) => r?.data || []);
	return {
		doc: { id: found.id, nomor_retur: found.nomor_retur, qr_token: found.qr_token, status: found.status, linked: rows.length, linkedEquipment: 0 },
		rowIds: rows.map((r) => r.id)
	};
}

async function rollbackRows(ids: number[]) {
	for (const id of ids) {
		await directusServerJson(`/items/packing_returns/${id}`, { method: 'DELETE' }).catch((e) =>
			console.error(`[returSubmit] rollback gagal hapus packing_returns ${id}:`, e?.message || e)
		);
	}
}

/** RSM-13: tolak (409) item yang qty-nya melebihi saldo − qty terkunci mutasi. Tanpa mutasi aktif = tidak ada I/O tambahan selain 1 query. */
export async function tolakBilaQtyTerkunciMutasi(projectId: number, items: SubmitReturItem[]): Promise<void> {
	const terkunci = await getQtyTerkunciMutasi(projectId);
	if (!terkunci.size) return;
	const kena = items.filter((i) => i.item_id != null && (terkunci.get(Number(i.item_id)) || 0) > 0);
	if (!kena.length) return;
	const ids = [...new Set(kena.map((i) => Number(i.item_id)))];
	const balRows = await directusServerJson<{ data: Array<{ item_id: number; qty_on_hand: number }> }>(
		`/items/project_stock_balance?${qs({ filter: { project_id: { _eq: projectId }, item_id: { _in: ids } }, fields: 'item_id,qty_on_hand', limit: '-1' })}`
	).then((r) => r?.data || []);
	const saldo = new Map(balRows.map((b) => [Number(b.item_id), Number(b.qty_on_hand) || 0]));
	const melanggar = kena.filter((i) => {
		const id = Number(i.item_id);
		if (!saldo.has(id)) return false; // saldo tak diketahui: dobel/saldo ditangani cek lain
		return (Number(i.qty_returned) || 0) > saldoTersedia(saldo.get(id) as number, terkunci.get(id) || 0) + 0.0001;
	});
	if (!melanggar.length) return;
	const rincian = melanggar
		.map((i) => `${i.material_name} (saldo ${saldo.get(Number(i.item_id))}, terkunci mutasi ${terkunci.get(Number(i.item_id))})`)
		.join('; ');
	throw new ReturSubmitError(
		409,
		'RTN_QTY_TERKUNCI',
		`Sebagian barang sedang diajukan untuk dimutasi ke proyek lain dan belum berangkat: ${rincian}. Kurangi jumlah retur, atau batalkan mutasinya di menu Mutasi Barang.`
	);
}

export async function submitReturPengajuan(input: SubmitReturInput): Promise<SubmitReturResult> {
	const { projectId } = input;
	const sumber = input.sumber ?? 'lapangan';
	const tag = input.clientSubmissionId ? subTag(String(input.clientSubmissionId).slice(0, 64)) : null;

	// 1. Idempoten: pengiriman ulang dengan id yang sama mengembalikan dokumen yang sudah ada.
	if (tag) {
		const existing = await loadIdempotent(projectId, tag);
		if (existing) return { doc: existing.doc, rowIds: existing.rowIds, idempotent: true, dobel: [], gateMode: 'shadow' };
	}

	// 1b. RSM-13 §4.2: barang yang sedang dikunci mutasi (diajukan/disetujui, belum berangkat) tidak boleh diretur.
	//     Bukan gate: ini integritas saldo (sama sifatnya dengan cek saldo), dan hanya aktif bila ada mutasi aktif.
	await tolakBilaQtyTerkunciMutasi(projectId, input.items);

	// 2. Gate G_RTN_DOBEL (shadow default bila belum terdaftar — Aturan #3).
	const gateMode = await getFieldGateMode(GATE_RTN_DOBEL);
	const dobel = await findActiveReturDuplicates(projectId, input.items);
	const override = String(input.overrideReason || '').trim();
	if (dobel.length) {
		const ringkas = dobel.map((d) => `${d.materialName}${d.existingDocNo ? ` (${d.existingDocNo})` : ` (pengajuan #${d.existingRowId})`}`).join(', ');
		const snapshot = { projectId, dobel, overrideReason: override || null };
		if (gateMode === 'shadow') {
			await writeGateAudit({ gate: GATE_RTN_DOBEL, collection: 'packing_returns', recordId: null, decision: 'shadow', reason: ringkas, snapshot, email: input.email });
		} else if (gateMode === 'soft' && override.length >= MIN_OVERRIDE_CHARS) {
			await writeGateAudit({ gate: GATE_RTN_DOBEL, collection: 'packing_returns', recordId: null, decision: 'allow', reason: override, snapshot, email: input.email });
		} else {
			await writeGateAudit({ gate: GATE_RTN_DOBEL, collection: 'packing_returns', recordId: null, decision: 'block', reason: ringkas, snapshot, email: input.email });
			throw new ReturSubmitError(
				409,
				'RTN_DOBEL',
				gateMode === 'soft'
					? `Barang ini sudah diajukan retur dan belum selesai: ${ringkas}. Bila ini gelombang retur yang berbeda, isi alasan minimal ${MIN_OVERRIDE_CHARS} karakter. Bila pengajuan sebelumnya salah, batalkan dulu di Status Pengembalian.`
					: `Barang ini sudah diajukan retur dan belum selesai: ${ringkas}. Buka Status Pengembalian; batalkan pengajuan lama bila ingin menggantinya.`,
				dobel
			);
		}
	}

	// 3. Baris packing_returns — berurutan (urutan id = urutan input, dipakai klien untuk menautkan foto).
	const now = new Date().toISOString();
	const rowIds: number[] = [];
	try {
		for (const item of input.items) {
			const created = await directusServerJson<{ data: { id: number } }>(`/items/packing_returns`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					project_id: projectId,
					material_name: item.material_name,
					material_color: item.material_color || '',
					qty_returned: item.qty_returned,
					unit: item.unit,
					leader_notes: item.leader_notes || '',
					condition: item.condition,
					return_status: 'return_requested',
					submitted_by: input.submittedByName,
					date_created: now,
					...(item.item_id != null ? { item_id: item.item_id } : {}),
					...(item.packing_list_id != null ? { packing_list_id: item.packing_list_id } : {}),
					...(item.packing_list_item_id != null ? { packing_list_item_id: item.packing_list_item_id } : {})
				})
			});
			if (!created?.data?.id) throw new Error('Directus tidak mengembalikan id baris retur');
			rowIds.push(created.data.id);
		}
	} catch (e) {
		await rollbackRows(rowIds);
		throw new ReturSubmitError(502, 'RTN_ROWS_FAILED', `Gagal menyimpan baris retur: ${(e as Error)?.message || e}. Tidak ada data yang tersimpan — aman untuk dicoba lagi.`);
	}

	// 4. Header dokumen — SELALU dibuat (leader langsung dapat nomor RTN). Gagal -> rollback baris.
	const olehInventory = input.penerbit === 'inventory' && sumber !== 'karantina';
	const notes = [input.notes?.trim(), tag].filter(Boolean).join(' ') || null;
	try {
		const doc = await createReturDocument({
			projectId,
			packingReturnIds: rowIds,
			equipmentLoanIds: input.equipmentLoanIds || [],
			submittedByKaryawanId: input.submittedByKaryawanId,
			submittedByUid: input.submittedByUid,
			driverName: olehInventory ? null : input.driverName || null,
			driverPhone: olehInventory ? null : input.driverPhone || null,
			vehiclePlate: olehInventory ? null : input.vehiclePlate || null,
			expeditionName: olehInventory ? null : input.expeditionName || null,
			notes,
			sumber,
			status: olehInventory ? 'draft' : 'dikirim'
		});
		return { doc, rowIds, idempotent: false, dobel, gateMode };
	} catch (e) {
		await rollbackRows(rowIds);
		throw new ReturSubmitError(502, 'RTN_DOC_FAILED', `Gagal membuat dokumen retur: ${(e as Error)?.message || e}. Tidak ada data yang tersimpan — aman untuk dicoba lagi.`);
	}
}
