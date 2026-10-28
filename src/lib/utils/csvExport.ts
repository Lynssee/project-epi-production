// src/lib/utils/csvExport.ts
// Export CSV ringan untuk dashboard lapangan — NOL dependency.
// BOM UTF-8 + CRLF supaya Excel / Google Sheets rapi membuka teks berbahasa Indonesia.

export interface CsvColumn {
	header: string;
	key: string;
}

function escapeCell(value: unknown): string {
	if (value === null || value === undefined) return '';
	const s = String(value);
	if (/[",\r\n]/.test(s)) {
		return `"${s.replace(/"/g, '""')}"`;
	}
	return s;
}

/**
 * Ubah baris objek → string CSV. `columns` menentukan urutan & judul kolom;
 * kalau kosong, dipakai key dari baris pertama.
 */
export function rowsToCsv(
	rows: Array<Record<string, unknown>>,
	columns?: CsvColumn[]
): string {
	const list = Array.isArray(rows) ? rows : [];
	const cols: CsvColumn[] =
		columns && columns.length
			? columns
			: list.length
				? Object.keys(list[0]).map((k) => ({ header: k, key: k }))
				: [];
	const lines: string[] = [];
	lines.push(cols.map((c) => escapeCell(c.header)).join(','));
	for (const r of list) {
		lines.push(cols.map((c) => escapeCell(r?.[c.key])).join(','));
	}
	return lines.join('\r\n');
}

/**
 * Ubah array-of-objects jadi string CSV (dengan BOM). Kolom = union kunci baris pertama
 * (atau `columns` bila diberi: array `[key, header]` atau `key`).
 */
export function toCsv(
	rows: Array<Record<string, unknown>>,
	columns?: Array<string | [string, string]>
): string {
	const list = Array.isArray(rows) ? rows : [];
	const cols: Array<[string, string]> = (columns && columns.length
		? columns
		: Object.keys(list[0] ?? {})
	).map((c) => (Array.isArray(c) ? c : [c, c]));
	const head = cols.map(([, h]) => escapeCell(h)).join(',');
	const body = list.map((r) => cols.map(([k]) => escapeCell(r?.[k])).join(',')).join('\r\n');
	return '\uFEFF' + head + (body ? '\r\n' + body : '') + '\r\n';
}

/** Bangun Blob CSV (BOM) tanpa memicu unduhan — untuk navigator.share(). */
export function buildCsvBlob(
	rows: Array<Record<string, unknown>>,
	columns?: CsvColumn[]
): Blob {
	return new Blob(['\uFEFF' + rowsToCsv(rows, columns)], { type: 'text/csv;charset=utf-8;' });
}

/**
 * Picu unduhan file CSV di browser.
 * Mendukung pemanggilan dengan:
 * 1. downloadCsv(csvString, filename)
 * 2. downloadCsv(rowsArray, filename, columns)
 */
export function downloadCsv(
	csvOrRows: string | Array<Record<string, unknown>>,
	filename: string,
	columns?: CsvColumn[]
): { success: boolean; error?: string } | void {
	try {
		if (typeof window === 'undefined') return { success: false, error: 'Bukan di browser' };

		let content: string;
		if (typeof csvOrRows === 'string') {
			content = csvOrRows;
		} else {
			if (!Array.isArray(csvOrRows) || csvOrRows.length === 0) {
				return { success: false, error: 'Tidak ada data untuk diekspor' };
			}
			content = '\uFEFF' + rowsToCsv(csvOrRows, columns);
		}

		const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		const name = filename.endsWith('.csv') ? filename : `${filename}.csv`;
		a.download = name;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		return { success: true };
	} catch (error) {
		console.error('Error exporting CSV:', error);
		return { success: false, error: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * "Quick Share WA": bagikan berkas CSV lewat `navigator.share()`
 * bila didukung — user pilih WhatsApp dari sheet berbagi. Fallback: unduhan biasa.
 */
export async function shareOrDownloadCsv(
	csv: string,
	filename: string,
	title = 'Data Sales'
): Promise<'shared' | 'downloaded'> {
	const name = filename.endsWith('.csv') ? filename : `${filename}.csv`;
	try {
		const file = new File([csv], name, { type: 'text/csv' });
		const nav = navigator as Navigator & {
			canShare?: (data?: { files?: File[] }) => boolean;
		};
		if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
			await nav.share({ files: [file], title });
			return 'shared';
		}
	} catch (e) {
		if ((e as Error)?.name === 'AbortError') return 'downloaded';
	}
	downloadCsv(csv, name);
	return 'downloaded';
}
