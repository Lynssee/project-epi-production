// src/lib/pdf-templates/produksiTablePdf.ts
// Template HTML generik tabel Produksi lapangan → PDF lewat Gotenberg (server).
// Dipakai endpoint /api/export/produksi. Nol beban bundle klien.
// Pola disalin dari essTablePdf.ts (feat/ess-export-multiformat).

const COMPANY_NAME = 'PT Eltama Prima Indo';

function escHtml(v: unknown): string {
	return String(v ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export interface ProduksiTablePdfInput {
	judul: string;
	subjudul?: string;
	kolom: string[];
	baris: Array<Array<string | number | null>>;
	dicetakOleh?: string;
	/** B2: data: URI QR (dari `qrcode`) → dipindai penerima untuk cek data terkini di aplikasi. */
	qrDataUri?: string;
}

export function buildProduksiTablePdfHtml(input: ProduksiTablePdfInput): string {
	const { judul, subjudul = '', kolom, baris, dicetakOleh = '', qrDataUri = '' } = input;
	const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

	const thead = kolom.map((k) => `<th>${escHtml(k)}</th>`).join('');
	const tbody = baris
		.map((row) => `<tr>${kolom.map((_, i) => `<td>${escHtml(row[i])}</td>`).join('')}</tr>`)
		.join('');

	return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<style>
	* { box-sizing: border-box; }
	body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 28px; font-size: 11px; }
	.kop { text-align: center; margin-bottom: 6px; }
	.kop .company { font-size: 14px; font-weight: 800; letter-spacing: .3px; }
	.kop .title { font-size: 12px; font-weight: 700; color: #1e3a8a; margin-top: 6px; }
	.kop .subtitle { font-size: 9px; color: #64748b; margin-top: 2px; }
	table { width: 100%; border-collapse: collapse; margin-top: 12px; }
	th, td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: left; vertical-align: top; }
	th { background: #f1f5f9; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: .3px; }
	tr:nth-child(even) td { background: #f8fafc; }
	.foot { margin-top: 14px; font-size: 8px; color: #64748b; display: flex; justify-content: space-between; }
	.empty { margin-top: 16px; color: #64748b; font-style: italic; }
	.qr { position: absolute; top: 24px; right: 24px; text-align: center; }
	.qr img { width: 72px; height: 72px; }
	.qr div { font-size: 6.5px; color: #94a3b8; margin-top: 2px; max-width: 78px; }
</style>
</head>
<body>
	${
		qrDataUri
			? `<div class="qr"><img src="${escHtml(qrDataUri)}" alt="QR verifikasi" /><div>Pindai untuk cek data terkini</div></div>`
			: ''
	}
	<div class="kop">
		<div class="company">${escHtml(COMPANY_NAME)}</div>
		<div class="title">${escHtml(judul)}</div>
		${subjudul ? `<div class="subtitle">${escHtml(subjudul)}</div>` : ''}
	</div>
	${
		baris.length
			? `<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`
			: `<p class="empty">Tidak ada data untuk ditampilkan.</p>`
	}
	<div class="foot">
		<span>Dicetak: ${escHtml(now)}${dicetakOleh ? ` · oleh ${escHtml(dicetakOleh)}` : ''}</span>
		<span>${escHtml(COMPANY_NAME)} — Monitoring Produksi</span>
	</div>
</body>
</html>`;
}
