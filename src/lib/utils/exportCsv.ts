// src/lib/utils/exportCsv.ts
// Penulis CSV minimal untuk dashboard lapangan. BUKAN papaparse — repo ini hanya
// perlu MENULIS CSV, tidak mem-parsing. BOM UTF-8 di depan supaya Excel Indonesia
// tidak salah membaca karakter (é, ×, dst).

export interface CsvColumn {
	key: string;
	label: string;
}

function esc(v: unknown): string {
	const s = v == null ? '' : String(v);
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** rows + kolom → string CSV (dengan BOM, CRLF). */
export function buildCsv(rows: Array<Record<string, unknown>>, columns: CsvColumn[]): string {
	const head = columns.map((c) => esc(c.label)).join(',');
	const body = (rows || [])
		.map((r) => columns.map((c) => esc(r?.[c.key])).join(','))
		.join('\r\n');
	return '\uFEFF' + head + (body ? '\r\n' + body : '') + '\r\n';
}

/** Blob text/csv siap dibagikan / diunduh. */
export function csvBlob(rows: Array<Record<string, unknown>>, columns: CsvColumn[]): Blob {
	return new Blob([buildCsv(rows, columns)], { type: 'text/csv;charset=utf-8' });
}

/** File CSV bernama — untuk Web Share API (navigator.share({ files })). */
export function csvFile(
	rows: Array<Record<string, unknown>>,
	columns: CsvColumn[],
	filename: string
): File {
	const name = filename.endsWith('.csv') ? filename : `${filename}.csv`;
	return new File([csvBlob(rows, columns)], name, { type: 'text/csv;charset=utf-8' });
}
