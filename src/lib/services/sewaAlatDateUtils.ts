// src/lib/services/sewaAlatDateUtils.ts
// Fase 6, Rencana Pertajam Rental Order v2 §9.2 L2/L3 — fungsi PURE tanpa import apa pun
// (bukan Directus, bukan $app/*), supaya bisa diuji via `node --test` langsung tanpa perlu
// meniru resolusi modul Vite. Pola sama dengan rabCoaMapping.ts/financeCoaMap.ts di repo ini.
// sewaAlatLapanganApi.ts mengimpor & re-export dari sini, JANGAN duplikasi logikanya di sana.

/** Hari tersisa sampai end_date (negatif = sudah lewat tenggat). Null kalau end_date kosong/tidak valid. */
export function hitungHariTersisa(endDate: string | null | undefined): number | null {
	if (!endDate) return null;
	const target = new Date(endDate);
	if (Number.isNaN(target.getTime())) return null;
	const now = new Date();
	target.setHours(0, 0, 0, 0);
	now.setHours(0, 0, 0, 0);
	return Math.round((target.getTime() - now.getTime()) / 86400000);
}
