// src/lib/server/receiveProjectDelivery.ts
// RSM-11 (24 Okt 2026) — SATU titik "barang SJ diterima proyek": menulis IN-RECEIPT ke project_stock_ledger dan
// mengakui biaya (project_expenses.is_received = true, qty & nilai terisi). Dipanggil oleh:
//   • aksi Loloskan satpam bila setelan inventory.terima_site.mode = 'otomatis_gerbang'
//   • automasi batas hari (mode 'konfirmasi_leader' tapi leader tidak mengonfirmasi) — source 'auto_batas'
// Idempoten PER BARIS BIAYA (kunci `recv-<sjId>-exp-<expenseId>`) — sekaligus memperbaiki bug lama kunci per-item
// yang menelan baris kedua berisi barang sama. Tidak menulis ulang bila SJ itu sudah punya IN-RECEIPT lama untuk item
// yang sama (SJ yang lahir di mode lama / jalur GR) sehingga tidak ada IN-RECEIPT ganda.

import { directusServerJson } from '$lib/server/directus';
import { appendLedgerEntry, rebuildProjectStockBalance, TRANSACTION_TYPES } from '$lib/server/projectLedger';

export type SumberTerima = 'gerbang' | 'konfirmasi' | 'auto_batas';

export interface BarisBiayaTertunda {
	id: number;
	project_id: number;
	identitas_barang_id: number | null;
	qty_sent: number | string | null;
	unit_price: number | string | null;
	rab_budget_id: number | null;
	source: string | null;
}

export interface RencanaTerima {
	tulis: Array<{ expense: BarisBiayaTertunda; qty: number; unitPrice: number; nilai: number; kunci: string; tulisLedger: boolean }>;
	lewati: Array<{ expenseId: number; alasan: string }>;
}

const num = (v: unknown) => Number(v) || 0;

/**
 * Murni: tentukan apa yang ditulis. `ledgerLama` = IN-RECEIPT yang SUDAH ada untuk SJ ini (item_id saja cukup).
 * Baris sj_equipment_usage (tarif sewa internal alat) hanya menandai diterima — nilainya sudah berupa estimasi.
 */
export function rencanakanPenerimaan(sjId: number, expenses: BarisBiayaTertunda[], ledgerLama: Array<{ item_id: number }>): RencanaTerima {
	const sudahAda = new Set(ledgerLama.map((l) => Number(l.item_id)));
	const out: RencanaTerima = { tulis: [], lewati: [] };
	for (const e of expenses) {
		const qty = num(e.qty_sent);
		if (qty <= 0) {
			out.lewati.push({ expenseId: e.id, alasan: 'qty_sent kosong' });
			continue;
		}
		const unitPrice = num(e.unit_price);
		const itemId = e.identitas_barang_id ? Number(e.identitas_barang_id) : null;
		out.tulis.push({
			expense: e,
			qty,
			unitPrice,
			nilai: e.source === 'sj_equipment_usage' ? -1 : qty * unitPrice, // -1 = jangan ubah nilai
			kunci: `recv-${sjId}-exp-${e.id}`,
			// ledger hanya bila ada identitas item DAN SJ ini belum punya IN-RECEIPT lama untuk item itu
			tulisLedger: !!itemId && !sudahAda.has(itemId)
		});
		if (itemId && sudahAda.has(itemId)) out.lewati.push({ expenseId: e.id, alasan: 'IN-RECEIPT lama sudah ada (ledger tidak ditulis ulang)' });
	}
	return out;
}

/** Murni: SJ yang sudah melewati batas hari sejak acuan (lolos gerbang, atau dibuat bila tak lewat gerbang). */
export function sjMelewatiBatas(sjs: Array<{ id: number; security_verified_at?: string | null; date_created?: string | null }>, batasHari: number, now = Date.now()) {
	const batasMs = batasHari * 86_400_000;
	return sjs.filter((s) => {
		const acuan = s.security_verified_at || s.date_created;
		const t = acuan ? new Date(acuan).getTime() : NaN;
		return Number.isFinite(t) && now - t >= batasMs;
	});
}

export interface HasilTerima {
	sjId: number;
	diakui: number;
	ledgerDitulis: number;
	dilewati: Array<{ expenseId: number; alasan: string }>;
}

export async function receiveProjectDelivery(
	sjId: number,
	opts: { by?: { id: number | null; nama: string } | null; source: SumberTerima }
): Promise<HasilTerima> {
	const sj = (await directusServerJson<{ data: any }>(`/items/surat_jalan/${sjId}?fields=id,nomor_sj,project_id`).catch(() => null))?.data;
	if (!sj?.project_id) return { sjId, diakui: 0, ledgerDitulis: 0, dilewati: [{ expenseId: 0, alasan: 'bukan SJ proyek' }] };

	// Query terpisah per koleksi (Aturan #2)
	const expenses = (await directusServerJson<{ data: BarisBiayaTertunda[] }>(
		`/items/project_expenses?filter[surat_jalan_id][_eq]=${sjId}&filter[is_received][_eq]=false` +
			`&fields=id,project_id,identitas_barang_id,qty_sent,unit_price,rab_budget_id,source&limit=-1`
	))?.data || [];
	if (!expenses.length) return { sjId, diakui: 0, ledgerDitulis: 0, dilewati: [] };

	const ledgerLama = (await directusServerJson<{ data: Array<{ item_id: number }> }>(
		`/items/project_stock_ledger?filter[reference_type][_eq]=surat_jalan&filter[reference_id][_eq]=${sjId}` +
			`&filter[transaction_type][_eq]=${encodeURIComponent(TRANSACTION_TYPES.IN_RECEIPT)}&fields=item_id&limit=-1`
	).catch((e) => {
		// Aturan #1: jangan ditelan diam-diam. Tanpa daftar ini, risiko IN-RECEIPT ganda -> berhenti, bukan menebak.
		throw new Error(`Gagal membaca ledger lama SJ ${sjId}: ${e?.message || e}`);
	}))?.data || [];

	const rencana = rencanakanPenerimaan(sjId, expenses, ledgerLama);
	let ledgerDitulis = 0;
	for (const r of rencana.tulis) {
		const patch: Record<string, unknown> = { is_received: true, qty: r.qty };
		if (r.nilai >= 0) {
			patch.expense_amount = r.nilai;
			patch.debit_amount = r.nilai;
		}
		await directusServerJson(`/items/project_expenses/${r.expense.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
		if (r.tulisLedger) {
			const res = await appendLedgerEntry({
				projectId: Number(r.expense.project_id),
				itemId: Number(r.expense.identitas_barang_id),
				projectBudgetId: r.expense.rab_budget_id || null,
				transactionType: TRANSACTION_TYPES.IN_RECEIPT,
				quantity: r.qty,
				unitPrice: r.unitPrice,
				referenceType: 'surat_jalan',
				referenceId: sjId,
				referenceNo: sj.nomor_sj,
				submittedBy: opts.by?.id ?? null,
				clientTxnId: r.kunci
			});
			if (res.entry && !res.deduped) ledgerDitulis++;
		}
	}
	if (ledgerDitulis > 0) {
		rebuildProjectStockBalance({ projectId: Number(sj.project_id) }).catch((e) =>
			console.error('[receiveProjectDelivery] gagal rebuild saldo proyek', sj.project_id, e?.message || e)
		);
	}
	return { sjId, diakui: rencana.tulis.length, ledgerDitulis, dilewati: rencana.lewati };
}
