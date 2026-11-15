// src/lib/server/preventive/pmNext.ts
// PMT-51 — jatuh tempo siklus PM berikutnya (kalender). Salinan kecil dari erp-epi src/lib/shared/pmBulanan.js
// (dua repo tidak berbagi lib — jaga keduanya identik: klem akhir bulan 31 Jan + 1 bln = 28/29 Feb).

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
function parse(s: string): Date | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? ''));
	return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

export function addMonthsClamped(dateStr: string, n: number): string | null {
	const d = parse(dateStr);
	if (!d || !Number.isInteger(n)) return null;
	const y = d.getUTCFullYear();
	const m = d.getUTCMonth() + n;
	const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
	return fmt(new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay))));
}

export function addDaysStr(dateStr: string, n: number): string | null {
	const d = parse(dateStr);
	if (!d || !Number.isInteger(n)) return null;
	d.setUTCDate(d.getUTCDate() + n);
	return fmt(d);
}

/** satuan = nama kategori interval_unit. Jam/KM → null (butuh hoursmeter, tidak dijadwalkan per kalender). */
export function nextDueDate(doneDate: string, nilai: unknown, satuan: string | null | undefined): string | null {
	const n = Number(nilai);
	if (!Number.isInteger(n) || n < 1) return null;
	if (satuan === 'Bulan') return addMonthsClamped(doneDate, n);
	if (satuan === 'Tahun') return addMonthsClamped(doneDate, n * 12);
	if (satuan === 'Hari') return addDaysStr(doneDate, n);
	return null;
}
