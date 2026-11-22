// src/lib/server/produksi/dataHealth.ts
// Fase 5 (Laporan Bulanan Manufaktur & Pertajam KPI): penghitung "kesehatan data SPK" untuk hub produksi lapangan.
// MURNI (tanpa I/O). Dua akar masalah akurasi KPI Manufaktur:
//   1) SPK sudah selesai produksi tapi BELUM berstatus QC  -> defect rate / FPY hanya dari sebagian SPK.
//   2) SPK berjalan TANPA deadline                          -> ketepatan waktu tak terukur.
// Hanya informasi untuk operator/supervisor; tidak memblokir input apa pun.

export interface SpkHealthRow {
	id: number | string;
	nomor?: string | null;
	status?: string | null;
	quality_status?: string | null;
	production_deadline?: string | null;
}

export interface SpkDataHealth {
	/** SPK completed/qc_pending dalam jendela waktu yang belum punya quality_status. */
	belumQc: { total: number; contoh: string[] };
	/** SPK in_progress tanpa production_deadline. */
	tanpaDeadline: { total: number; contoh: string[] };
	windowHari: number;
}

const blank = (v: unknown) => v == null || String(v).trim() === '';
const label = (r: SpkHealthRow) => String(r.nomor || `SPK-${r.id}`);

/** @param belumQcRows  SPK selesai/menunggu QC (sudah difilter jendela waktu di server)  @param aktifRows  SPK in_progress */
export function summarizeSpkDataHealth(
	belumQcRows: SpkHealthRow[] | null | undefined,
	aktifRows: SpkHealthRow[] | null | undefined,
	opts: { windowHari?: number; contoh?: number } = {}
): SpkDataHealth {
	const contoh = opts.contoh ?? 5;
	const qc = (belumQcRows || []).filter((r) => blank(r.quality_status));
	const dl = (aktifRows || []).filter((r) => blank(r.production_deadline));
	return {
		belumQc: { total: qc.length, contoh: qc.slice(0, contoh).map(label) },
		tanpaDeadline: { total: dl.length, contoh: dl.slice(0, contoh).map(label) },
		windowHari: opts.windowHari ?? 30
	};
}
