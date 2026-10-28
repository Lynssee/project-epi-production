// Fase 1 (Manpower Payroll — polish lampiran): ekspor rekap absensi & gaji ke .xlsx dengan layout
// yang sama dengan tabel PDF (per-pekerja kolom IN/OT/UM/SB/KASBON, baris total di footer) —
// dipakai sebagai alternatif unduhan selain PDF/PNG. Client-side saja (SheetJS), tanpa server.
import * as XLSX from 'xlsx';

export interface PayrollExcelDate {
	dateStr: string;
	hari: string;
	tanggal: string;
}

export interface PayrollExcelWorker {
	id: any;
	nama: string;
	jabatan: string;
	rate_upah: number;
	rate_lembur: number;
	rate_um: number;
	rate_sb: number;
}

export interface PayrollExcelCell {
	in_val?: number;
	ot_hours?: number;
	um_val?: number;
	sb_val?: number;
	kasbon_val?: number;
}

export interface PayrollExcelTotal {
	tIn: number;
	tOt: number;
	tUm: number;
	tSb: number;
	kasbon: number;
	subtotal: number;
	final: number;
}

export interface BuildPayrollExcelParams {
	projectLabel: string;
	rangeLabel: string;
	dates: PayrollExcelDate[];
	workers: PayrollExcelWorker[];
	getCell: (workerId: any, dateStr: string) => PayrollExcelCell | undefined;
	totals: PayrollExcelTotal[];
	notes?: string;
	dibuatOleh?: string;
}

const SUB_COLS = ['IN', 'OT', 'UM', 'SB', 'KASBON'] as const;

export function buildPayrollWorkbook(params: BuildPayrollExcelParams): XLSX.WorkBook {
	const { projectLabel, rangeLabel, dates, workers, getCell, totals, notes, dibuatOleh } = params;

	const rows: any[][] = [];
	const merges: XLSX.Range[] = [];

	rows.push([`Rekap Absensi & Gaji — ${projectLabel}`]);
	rows.push([`Periode: ${rangeLabel}`]);
	rows.push([]);

	// Header row 1: nama pekerja (colspan 5 tiap pekerja)
	const headerNameRow: any[] = ['Pekerja', ''];
	for (const w of workers) {
		headerNameRow.push(w.nama, '', '', '', '');
	}
	rows.push(headerNameRow);

	// Header row 2: jabatan
	const headerJabatanRow: any[] = ['Jabatan', ''];
	for (const w of workers) {
		headerJabatanRow.push(w.jabatan, '', '', '', '');
	}
	rows.push(headerJabatanRow);

	// Header row 3: sub kolom
	const headerSubRow: any[] = ['HARI', 'TANGGAL'];
	for (const _w of workers) {
		headerSubRow.push(...SUB_COLS);
	}
	rows.push(headerSubRow);

	const headerRowStart = 3; // 0-indexed: baris headerNameRow
	for (let i = 0; i < workers.length; i++) {
		const col = 2 + i * 5;
		merges.push({ s: { r: headerRowStart, c: col }, e: { r: headerRowStart, c: col + 4 } });
		merges.push({ s: { r: headerRowStart + 1, c: col }, e: { r: headerRowStart + 1, c: col + 4 } });
	}

	// Body: satu baris per tanggal
	for (const d of dates) {
		const row: any[] = [d.hari, d.tanggal];
		for (const w of workers) {
			const c = getCell(w.id, d.dateStr);
			row.push(c?.in_val || '', c?.ot_hours || '', c?.um_val || '', c?.sb_val || '', c?.kasbon_val || '');
		}
		rows.push(row);
	}

	const footerLabelRow = (label: string, cells: (w: PayrollExcelWorker, i: number) => any[]) => {
		const row: any[] = [label, ''];
		workers.forEach((w, i) => row.push(...cells(w, i)));
		return row;
	};

	rows.push(footerLabelRow('Total Harian Kerja', (_w, i) => [
		totals[i].tIn || '', totals[i].tOt || '', totals[i].tUm || '', totals[i].tSb || '', totals[i].kasbon || ''
	]));
	rows.push(footerLabelRow('Upah Harian', (w) => [w.rate_upah, '', '', '', '']));
	rows.push(footerLabelRow('Total Harian', (w, i) => [totals[i].tIn * w.rate_upah, '', '', '', '']));
	rows.push(footerLabelRow('Lembur (Rp/jam)', (w) => [w.rate_lembur, '', '', '', '']));
	rows.push(footerLabelRow('Total Lembur', (w, i) => [totals[i].tOt * w.rate_lembur, '', '', '', '']));
	rows.push(footerLabelRow('Uang Makan (Rp/hari)', (w) => [w.rate_um, '', '', '', '']));
	rows.push(footerLabelRow('Total Uang Makan', (w, i) => [totals[i].tUm * w.rate_um, '', '', '', '']));
	rows.push(footerLabelRow('Stand by', (w) => [w.rate_sb, '', '', '', '']));
	rows.push(footerLabelRow('Total Stand by', (w, i) => [totals[i].tSb * w.rate_sb, '', '', '', '']));
	rows.push(footerLabelRow('Total Gaji', (_w, i) => [totals[i].subtotal, '', '', '', '']));
	rows.push(footerLabelRow('Total Kasbon', (_w, i) => [totals[i].kasbon, '', '', '', '']));
	rows.push(footerLabelRow('GAJI YANG DITERIMA', (_w, i) => [totals[i].final, '', '', '', '']));

	const footerStart = headerRowStart + 2 + dates.length; // baris pertama footer (Total Harian Kerja)
	const footerRowCount = 12;
	for (let r = footerStart; r < footerStart + footerRowCount; r++) {
		for (let i = 0; i < workers.length; i++) {
			const col = 2 + i * 5;
			merges.push({ s: { r, c: col }, e: { r, c: col + 4 } });
		}
	}

	const grandSubtotal = totals.reduce((sum, t) => sum + t.subtotal, 0);
	const grandKasbon = totals.reduce((sum, t) => sum + t.kasbon, 0);

	rows.push([]);
	rows.push(['Total sebelum kasbon', grandSubtotal]);
	rows.push(['Total Kasbon Keseluruhan', grandKasbon]);
	rows.push(['TOTAL KESELURUHAN', grandSubtotal - grandKasbon]);
	rows.push([]);
	if (notes && notes.trim()) {
		rows.push(['Catatan', notes.trim()]);
	}
	rows.push(['Dibuat oleh', dibuatOleh || '']);

	const ws = XLSX.utils.aoa_to_sheet(rows);
	ws['!merges'] = merges;
	ws['!cols'] = [{ wch: 12 }, { wch: 10 }, ...workers.flatMap(() => [{ wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 12 }])];

	const wb = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wb, ws, 'Rekap Gajian');
	return wb;
}

export function workbookToBlob(wb: XLSX.WorkBook): Blob {
	const buf: ArrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
	return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
