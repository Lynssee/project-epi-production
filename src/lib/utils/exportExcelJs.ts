// src/lib/utils/exportExcelJs.ts
// Fase "Export Universal — Dashboard Lapangan" (§5.1 rencana).
//
// Port TypeScript dari erp-epi `src/lib/utils/exportExcelJs.js`. Perbedaan penting:
//   • `exceljs` (±1 MB) di-`import()` DINAMIS DI DALAM fungsi — nol beban di bundle
//     awal PWA; ±1 MB hanya diunduh saat user benar-benar menekan Export, lalu
//     di-cache service worker.
//   • TIDAK ada hook arsip (`report_archives` hanya ada di sisi admin).
//
// Pengganti `xlsx` (SheetJS) — paket itu tak di-maintain & CVE-nya tak pernah
// dapat fix rilis. DILARANG menambah pemakaian `xlsx` baru di repo ini.

export interface ExcelColumn {
	header: string;
	key: string;
	width?: number;
}

export interface ExcelResult {
	success: boolean;
	error?: string;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function triggerDownload(buffer: ArrayBuffer, filename: string): void {
	if (typeof window === 'undefined') return;
	const blob = new Blob([buffer], { type: XLSX_MIME });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename.endsWith('.xlsx') ? filename : filename + '.xlsx';
	a.click();
	URL.revokeObjectURL(url);
}

/**
 * Bangun workbook 1-sheet → Blob (tanpa memicu unduhan). Untuk dipakai
 * navigator.share() / preview. Dynamic import exceljs sama seperti fungsi lain.
 */
export async function buildXlsxBlob(
	rows: Array<Record<string, unknown>>,
	sheet = 'Sheet1',
	columns?: ExcelColumn[]
): Promise<Blob> {
	const ExcelJS = (await import('exceljs')).default;
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet(sheet.slice(0, 31));
	ws.columns =
		columns ?? Object.keys(rows[0] ?? {}).map((key) => ({ header: key, key, width: 16 }));
	ws.addRows(rows);
	const buffer = await wb.xlsx.writeBuffer();
	return new Blob([buffer as ArrayBuffer], { type: XLSX_MIME });
}

/**
 * Export satu sheet ke Excel (ExcelJS, MIT).
 * @param rows Baris datar (key = kolom).
 * @param filename Nama file (akhiran .xlsx otomatis).
 * @param sheet Nama sheet.
 * @param columns Definisi kolom eksplisit — kalau kosong, header dari key baris pertama.
 */
export async function exportToExcelJs(
	rows: Array<Record<string, unknown>>,
	filename: string,
	sheet = 'Sheet1',
	columns?: ExcelColumn[]
): Promise<ExcelResult> {
	try {
		if (!Array.isArray(rows) || rows.length === 0) {
			throw new Error('Tidak ada data untuk diekspor');
		}
		const ExcelJS = (await import('exceljs')).default;
		const wb = new ExcelJS.Workbook();
		const ws = wb.addWorksheet(sheet.slice(0, 31));
		ws.columns =
			columns ??
			Object.keys(rows[0]).map((key) => ({ header: key, key, width: 16 }));
		ws.addRows(rows);
		const buffer = await wb.xlsx.writeBuffer();
		triggerDownload(buffer as ArrayBuffer, filename);
		return { success: true };
	} catch (error) {
		console.error('Error exporting to Excel (ExcelJS):', error);
		return { success: false, error: error instanceof Error ? error.message : String(error) };
	}
}

export interface ExcelSheetSpec {
	name: string;
	rows: Array<Record<string, unknown>>;
	columns?: ExcelColumn[];
}

/** Export beberapa sheet sekaligus ke satu workbook. */
export async function exportSheetsToExcelJs(
	sheets: ExcelSheetSpec[],
	filename: string
): Promise<ExcelResult> {
	try {
		const valid = (sheets || []).filter((s) => Array.isArray(s.rows) && s.rows.length > 0);
		if (valid.length === 0) {
			throw new Error('Tidak ada data untuk diekspor');
		}
		const ExcelJS = (await import('exceljs')).default;
		const wb = new ExcelJS.Workbook();
		valid.forEach((s, i) => {
			const ws = wb.addWorksheet((s.name || `Sheet${i + 1}`).slice(0, 31));
			ws.columns =
				s.columns ?? Object.keys(s.rows[0]).map((key) => ({ header: key, key, width: 16 }));
			ws.addRows(s.rows);
		});
		const buffer = await wb.xlsx.writeBuffer();
		triggerDownload(buffer as ArrayBuffer, filename);
		return { success: true };
	} catch (error) {
		console.error('Error exporting sheets to Excel (ExcelJS):', error);
		return { success: false, error: error instanceof Error ? error.message : String(error) };
	}
}
