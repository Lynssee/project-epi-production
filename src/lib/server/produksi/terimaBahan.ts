// src/lib/server/produksi/terimaBahan.ts
// Fase 3 (rencana "Lifecycle Pengeluaran Bahan Baku Produksi", 12 Okt 2026) — logika PURE
// penerimaan bahan baku SPK oleh Kepala Regu (akun sendiri) + usulan retur sisa bahan.
//
// Prinsip (sinkron dengan erp-epi `spkMaterialIssue.js`):
//   • HANYA tracking. Stok tidak disentuh: OUT-01 tetap saat Start Production, dan usulan retur
//     belum membuat transaksi stok (IN-05 menunggu keputusan fase berikutnya).
//   • Longgar (Aturan #3/#6): penerima boleh mengonfirmasi walau gudang belum menandai "Siap Serah"
//     — bahan fisiknya sudah di tangan, jangan dibuntukan oleh kelalaian gudang.
//   • Idempoten: konfirmasi ulang oleh orang yang sama = noop; oleh orang lain ditolak.

export const CHAIN_STATUSES = ['worksheet_generated', 'waiting_for_stock', 'in_progress', 'qc_pending'] as const;

export interface SpkMaterialRow {
	id: number;
	status?: string | null;
	material_pick_status?: string | null;
	material_ready_at?: string | null;
	material_received_by?: string | null;
	material_received_karyawan_id?: number | null;
	material_return_status?: string | null;
}

export interface ReturnRow {
	item_id: number | null;
	nama: string;
	qty_kg: number;
	note: string;
}

export type Plan =
	| { ok: true; noop: boolean; patch: Record<string, unknown> }
	| { ok: false; code: number; message: string };

const clip = (v: unknown, n: number): string => (typeof v === 'string' ? v.trim().slice(0, n) : '');

export function planReceipt(
	spk: SpkMaterialRow,
	ctx: { karyawanId: number; karyawanNama: string; note?: unknown; now?: string }
): Plan {
	if (!CHAIN_STATUSES.includes((spk.status || '') as (typeof CHAIN_STATUSES)[number])) {
		return { ok: false, code: 409, message: `Status SPK "${spk.status ?? '-'}" tidak bisa menerima bahan.` };
	}
	if (spk.material_pick_status === 'handed_over') {
		const same = spk.material_received_karyawan_id === ctx.karyawanId;
		if (same) return { ok: true, noop: true, patch: {} };
		return {
			ok: false,
			code: 409,
			message: `Bahan sudah tercatat diterima oleh ${spk.material_received_by || 'pihak lain'}.`
		};
	}
	const now = ctx.now || new Date().toISOString();
	const patch: Record<string, unknown> = {
		material_pick_status: 'handed_over',
		material_handover_at: now,
		material_received_by: clip(ctx.karyawanNama, 255) || `Karyawan #${ctx.karyawanId}`,
		material_received_karyawan_id: ctx.karyawanId,
		material_receipt_note: clip(ctx.note, 2000) || null
	};
	if (!spk.material_ready_at) patch.material_ready_at = now;
	return { ok: true, noop: false, patch };
}

export function sanitizeReturnRows(raw: unknown): ReturnRow[] {
	if (!Array.isArray(raw)) return [];
	const out: ReturnRow[] = [];
	for (const r of raw.slice(0, 100)) {
		if (!r || typeof r !== 'object') continue;
		const rec = r as Record<string, unknown>;
		const qty = Number(rec.qty_kg);
		if (!Number.isFinite(qty) || qty <= 0) continue;
		const itemId = Number(rec.item_id);
		out.push({
			item_id: Number.isFinite(itemId) && itemId > 0 ? itemId : null,
			nama: clip(rec.nama, 255),
			qty_kg: Math.round(qty * 1000) / 1000,
			note: clip(rec.note, 300)
		});
	}
	return out;
}

/** Sisa bersih terpotong per item (OUT - IN) untuk SPK. Sinkron dengan erp-epi spkMaterialReturn.js. */
export function netConsumedByItem(
	rows: Array<{ item_id: unknown; transaction_type?: string; quantity?: unknown }>
): Record<number, number> {
	const acc: Record<number, number> = {};
	for (const r of Array.isArray(rows) ? rows : []) {
		const raw = r?.item_id;
		const id = Number(typeof raw === 'object' && raw !== null ? (raw as { id?: unknown }).id : raw);
		if (!(id > 0)) continue;
		const q = Number(r.quantity);
		if (!Number.isFinite(q)) continue;
		acc[id] = (acc[id] || 0) + (r.transaction_type === 'OUT' ? q : r.transaction_type === 'IN' ? -q : 0);
	}
	for (const k of Object.keys(acc)) acc[Number(k)] = acc[Number(k)] > 0.001 ? Math.round(acc[Number(k)] * 1000) / 1000 : 0;
	return acc;
}

export function planReturn(
	spk: SpkMaterialRow,
	ctx: { karyawanNama: string; rows: unknown; now?: string; consumed?: Record<number, number> | null }
): Plan {
	if (spk.status === 'cancelled') {
		return { ok: false, code: 409, message: 'SPK dibatalkan; retur tidak bisa diajukan.' };
	}
	if (spk.material_pick_status !== 'handed_over') {
		return { ok: false, code: 409, message: 'Retur hanya bisa diajukan setelah bahan diterima di lantai produksi.' };
	}
	if (spk.material_return_status === 'diterima_gudang') {
		return { ok: false, code: 409, message: 'Retur sudah diterima gudang; tidak bisa diubah lagi.' };
	}
	const rows = sanitizeReturnRows(ctx.rows);
	if (rows.length === 0) {
		return { ok: false, code: 400, message: 'Isi minimal satu bahan dengan jumlah sisa lebih dari 0 kg.' };
	}
	// Bila ledger SPK tersedia: hanya bahan yang benar-benar terpotong dan tidak melebihi sisanya.
	// Tanpa itu gudang tak bisa memasukkan retur ke stok (butuh item_id yang valid).
	if (ctx.consumed) {
		const perItem: Record<number, number> = {};
		for (const r of rows) {
			if (r.item_id == null) {
				return { ok: false, code: 400, message: `Bahan "${r.nama || '?'}" tidak dikenali. Pilih dari daftar bahan SPK.` };
			}
			perItem[r.item_id] = (perItem[r.item_id] || 0) + r.qty_kg;
		}
		for (const [idStr, qty] of Object.entries(perItem)) {
			const net = ctx.consumed[Number(idStr)] ?? 0;
			if (net <= 0) return { ok: false, code: 409, message: 'Ada bahan yang tidak tercatat terpotong untuk SPK ini.' };
			if (qty > net + 0.001) return { ok: false, code: 409, message: `Sisa bahan melebihi yang terpotong (${net} kg).` };
		}
	}
	return {
		ok: true,
		noop: false,
		patch: {
			material_return_status: 'diajukan',
			material_return_data: rows,
			material_return_at: ctx.now || new Date().toISOString(),
			material_return_by: clip(ctx.karyawanNama, 255) || null
		}
	};
}
