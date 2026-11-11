// src/lib/shared/siteCostStatement.ts
// Lembar Pertanggungjawaban Anggaran Lapangan (Site Cost Statement) — logika MURNI, tanpa I/O.
// Untuk Project Leader: Pagu RAP vs Realisasi vs Sisa + komitmen terbuka (PA/PR) + LPJ belum selesai.
// SENGAJA tidak memakai nilai PO klien, pendapatan, laba, atau margin (batasan RBAC PROJECT_PROFITABILITY_VIEW).
// Fase 3 rencana "Laporan Keuangan Proyek Formal" (erp-epi). Nol query baru: data dari komponen yang sudah ada.

import {
	BUDGET_PENDING_STATUSES,
	BUDGET_IN_PROCESS_STATUSES,
	BUDGET_APPROVED_STATUSES,
	BUDGET_PARTIAL_STATUSES,
	BUDGET_PAID_STATUSES,
	BUDGET_REJECTED_STATUSES
} from '$lib/constants/status';

const num = (v: unknown): number => {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
};

export type CostLevel = 'aman' | 'waspada' | 'peringatan' | 'lebih' | 'tanpa_pagu';

export interface CostThresholds {
	watch: number;
	warning: number;
	critical: number;
}
export const DEFAULT_COST_THRESHOLDS: CostThresholds = { watch: 70, warning: 90, critical: 100 };

export const LEVEL_LABEL: Record<CostLevel, string> = {
	aman: 'Aman',
	waspada: 'Waspada',
	peringatan: 'Hampir Habis',
	lebih: 'Melebihi Pagu',
	tanpa_pagu: 'Tanpa Pagu'
};

/** Tingkat serapan: persen dari pagu RAP (realisasi saja, bukan komitmen). */
export function costLevel(rap: number, actual: number, t: CostThresholds = DEFAULT_COST_THRESHOLDS): CostLevel {
	if (rap <= 0) return actual > 0 ? 'tanpa_pagu' : 'aman';
	const pct = (actual / rap) * 100;
	if (pct > t.critical) return 'lebih';
	if (pct >= t.warning) return 'peringatan';
	if (pct >= t.watch) return 'waspada';
	return 'aman';
}

export interface StatementCategoryInput {
	id: string;
	label: string;
}
export interface PengajuanRow {
	nomor_pengajuan?: string | null;
	tujuan_pengajuan?: string | null;
	kategori?: string | null;
	status?: string | null;
	total_amount?: number | string | null;
	paid_amount_total?: number | string | null;
	outstanding_amount?: number | string | null;
	status_pertanggungjawaban?: string | null;
}
export interface ProcurementRow {
	pr_number?: string;
	status?: string;
	tujuan?: string;
	total_amount?: number;
	received_amount?: number;
}

export interface SiteCostStatement {
	rows: Array<{
		id: string;
		label: string;
		rap: number;
		actual: number;
		sisa: number;
		serapanPct: number | null;
		level: CostLevel;
	}>;
	total: { rap: number; actual: number; sisa: number; serapanPct: number | null; level: CostLevel };
	komitmen: {
		menunggu: { count: number; amount: number };
		disetujuiBelumCair: { count: number; amount: number };
		sebagian: { count: number; amount: number };
		prBelumDiterima: { count: number; amount: number };
		total: number;
	};
	/** Pagu − realisasi − komitmen terbuka. Bisa negatif = proyeksi melebihi pagu. */
	sisaJatahAman: number;
	lpj: {
		/** LPJ tertunggak: status_pertanggungjawaban = 'belum'. */
		count: number;
		amount: number;
		items: Array<{ nomor: string; tujuan: string; amount: number }>;
		/** LPJ sudah dikirim, menunggu verifikasi Finance (belum final). */
		menungguVerifikasi: { count: number; amount: number };
		/** Pengajuan OPERASIONAL sudah cair tetapi status LPJ kosong — celah pelacakan, BUKAN tunggakan. Upah/jasa tidak butuh LPJ. */
		tidakTerlacak: { count: number; amount: number };
	};
	catatan: string[];
}

/**
 * @param comparison  hasil getRABvsAktualisasi().data ({ categories: {id:{rab,actual}}, grand_rab, grand_actual, ... })
 * @param categories  daftar kategori aktif (urutan tampil)
 * @param pas         pengajuan_anggaran proyek ini
 * @param procurement riwayat PR/PO proyek ini
 */
export function buildSiteCostStatement(input: {
	comparison: any;
	categories: StatementCategoryInput[];
	pas?: PengajuanRow[];
	procurement?: ProcurementRow[];
	thresholds?: Partial<CostThresholds>;
}): SiteCostStatement {
	// Nilai undefined/NaN dari setelan tidak boleh menimpa default (spread akan menimpanya).
	const pick = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
	const t: CostThresholds = {
		watch: pick(input.thresholds?.watch, DEFAULT_COST_THRESHOLDS.watch),
		warning: pick(input.thresholds?.warning, DEFAULT_COST_THRESHOLDS.warning),
		critical: pick(input.thresholds?.critical, DEFAULT_COST_THRESHOLDS.critical)
	};
	const cmp = input.comparison?.categories || {};
	const catNotes: string[] = [];

	const rows = (input.categories || [])
		.map((c) => {
			const rap = num(cmp[c.id]?.rab);
			const actual = num(cmp[c.id]?.actual);
			return {
				id: c.id,
				label: c.label,
				rap,
				actual,
				sisa: rap - actual,
				serapanPct: rap > 0 ? Math.round((actual / rap) * 1000) / 10 : null,
				level: costLevel(rap, actual, t)
			};
		})
		.filter((r) => r.rap !== 0 || r.actual !== 0);

	const sumRap = rows.reduce((s, r) => s + r.rap, 0);
	const sumAct = rows.reduce((s, r) => s + r.actual, 0);
	const grandRap = num(input.comparison?.grand_rab);
	const grandAct = num(input.comparison?.grand_actual);
	if (input.comparison && (Math.abs(grandRap - sumRap) > 1 || Math.abs(grandAct - sumAct) > 1)) {
		catatan_push(catNotes, 'Total berbeda dari jumlah kategori tampil (ada kategori di luar daftar aktif).');
	}
	const totRap = input.comparison ? grandRap : sumRap;
	const totAct = input.comparison ? grandAct : sumAct;
	if (num(input.comparison?.akrual_belum_final) > 0) {
		catatan_push(catNotes, 'Realisasi memuat akrual absensi yang belum final.');
	}
	if (num(input.comparison?.unlinked_actual) > 0) {
		catatan_push(catNotes, 'Sebagian realisasi belum terhubung ke baris RAP.');
	}

	// Komitmen terbuka dari pengajuan anggaran
	const k = {
		menunggu: { count: 0, amount: 0 },
		disetujuiBelumCair: { count: 0, amount: 0 },
		sebagian: { count: 0, amount: 0 },
		prBelumDiterima: { count: 0, amount: 0 },
		total: 0
	};
	const lpjItems: SiteCostStatement['lpj']['items'] = [];
	const lpjVerif = { count: 0, amount: 0 };
	const lpjUntracked = { count: 0, amount: 0 };
	for (const p of input.pas || []) {
		const st = String(p.status || '').trim();
		if (BUDGET_REJECTED_STATUSES.has(st) || st === 'Dibatalkan') continue;
		const total = num(p.total_amount);
		if (BUDGET_PENDING_STATUSES.has(st) || BUDGET_IN_PROCESS_STATUSES.has(st)) {
			k.menunggu.count++;
			k.menunggu.amount += total;
		} else if (BUDGET_APPROVED_STATUSES.has(st)) {
			k.disetujuiBelumCair.count++;
			k.disetujuiBelumCair.amount += total;
		} else if (BUDGET_PARTIAL_STATUSES.has(st)) {
			const out = p.outstanding_amount != null ? num(p.outstanding_amount) : Math.max(total - num(p.paid_amount_total), 0);
			k.sebagian.count++;
			k.sebagian.amount += out;
		}
		// Hanya nilai 'belum' yang dihitung LPJ tertunggak; kosong tidak ditebak. Kosong pada pengajuan OPERASIONAL yang sudah cair
		// dilaporkan terpisah sebagai celah pelacakan (pengajuan belum cair/ditolak wajar kosong; upah/jasa tidak butuh LPJ).
		const spj = String(p.status_pertanggungjawaban || '').toLowerCase();
		if (spj === 'belum') {
			lpjItems.push({ nomor: String(p.nomor_pengajuan || '-'), tujuan: String(p.tujuan_pengajuan || ''), amount: total });
		} else if (spj === 'menunggu_verifikasi') {
			lpjVerif.count++;
			lpjVerif.amount += total;
		} else if (!spj && BUDGET_PAID_STATUSES.has(st) && String(p.kategori || '').toLowerCase() === 'operasional') {
			lpjUntracked.count++;
			lpjUntracked.amount += total;
		}
	}
	for (const r of input.procurement || []) {
		const total = num(r.total_amount);
		const open = total - num(r.received_amount);
		const st = String(r.status || '').toLowerCase();
		if (open > 0 && !/reject|ditolak|batal|cancel/.test(st)) {
			k.prBelumDiterima.count++;
			k.prBelumDiterima.amount += open;
		}
	}
	k.total = k.menunggu.amount + k.disetujuiBelumCair.amount + k.sebagian.amount + k.prBelumDiterima.amount;
	lpjItems.sort((a, b) => b.amount - a.amount);

	return {
		rows,
		total: {
			rap: totRap,
			actual: totAct,
			sisa: totRap - totAct,
			serapanPct: totRap > 0 ? Math.round((totAct / totRap) * 1000) / 10 : null,
			level: costLevel(totRap, totAct, t)
		},
		komitmen: k,
		sisaJatahAman: totRap - totAct - k.total,
		lpj: {
			count: lpjItems.length,
			amount: lpjItems.reduce((s, i) => s + i.amount, 0),
			items: lpjItems.slice(0, 10),
			menungguVerifikasi: lpjVerif,
			tidakTerlacak: lpjUntracked
		},
		catatan: catNotes
	};
}

function catatan_push(arr: string[], s: string) {
	arr.push(s);
}
