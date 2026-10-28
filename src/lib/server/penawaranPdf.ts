// src/lib/server/penawaranPdf.ts
// SERVER-ONLY. Render PDF penawaran harga (SI-TAMA Sales §5b) pakai pdfmake —
// pola sama dengan lib/server/asistenPdf.ts (Node murni, BUKAN Puppeteer, tidak
// menambah apa pun ke bundle klien). Rincian biaya memakai calcQuotationTotals
// yang sama dengan form kalkulator supaya angka PDF konsisten dengan layar.

import { calcQuotationTotals } from '$lib/utils/quotationCalc';
import {
	COMPANY_NAME,
	formatRupiah,
	formatTanggalId,
	type PenawaranHeaderRow,
	type PenawaranItemRow
} from './penawaranExport';

const FONTS = {
	Helvetica: {
		normal: 'Helvetica',
		bold: 'Helvetica-Bold',
		italics: 'Helvetica-Oblique',
		bolditalics: 'Helvetica-BoldOblique'
	}
};

const SERVICE_LABELS: Record<string, string> = {
	sandblasting: 'Sandblasting / Persiapan Permukaan',
	painting: 'Pengecatan (Painting)',
	floor_coating: 'Floor Coating',
	global_manpower: 'Tenaga Kerja (Borongan)'
};

function itemLabel(it: PenawaranItemRow): string {
	const base = it.object_name?.trim() || SERVICE_LABELS[it.service_type || ''] || 'Pekerjaan';
	const desc = it.description?.trim();
	return desc ? `${base}\n${desc}` : base;
}

export async function buildPenawaranPdfBuffer(
	header: PenawaranHeaderRow,
	items: PenawaranItemRow[]
): Promise<Buffer> {
	const PdfPrinter = (await import('pdfmake')).default;
	const printer = new PdfPrinter(FONTS);

	const totals = calcQuotationTotals(items, header);

	const lineItems = items.filter((it) => it.service_type !== 'global_manpower');
	const manpower = items.filter((it) => it.service_type === 'global_manpower');

	const bodyRows: any[] = [
		[
			{ text: 'No', style: 'th' },
			{ text: 'Deskripsi Pekerjaan', style: 'th' },
			{ text: 'Luas (m²)', style: 'th', alignment: 'right' },
			{ text: 'Harga Satuan', style: 'th', alignment: 'right' },
			{ text: 'Total', style: 'th', alignment: 'right' }
		]
	];

	let no = 1;
	for (const it of lineItems) {
		const rowArea = (Number(it.area) || 0) * (Number(it.qty) || 1);
		const unitPrice = rowArea > 0 ? (Number(it.subtotal) || 0) / rowArea : 0;
		bodyRows.push([
			{ text: String(no++), alignment: 'center' },
			{ text: itemLabel(it) },
			{ text: rowArea > 0 ? rowArea.toLocaleString('id-ID') : '-', alignment: 'right' },
			{ text: unitPrice > 0 ? formatRupiah(unitPrice) : '-', alignment: 'right' },
			{ text: formatRupiah(it.subtotal), alignment: 'right' }
		]);
	}
	for (const it of manpower) {
		bodyRows.push([
			{ text: String(no++), alignment: 'center' },
			{ text: SERVICE_LABELS.global_manpower },
			{ text: '-', alignment: 'right' },
			{ text: '-', alignment: 'right' },
			{ text: formatRupiah(it.subtotal), alignment: 'right' }
		]);
	}

	// Overhead + Margin + Komisi TIDAK dicetak sebagai baris terpisah di penawaran
	// customer (kebocoran struktur biaya internal — keputusan bisnis). Nilainya
	// dilebur ke "Subtotal Biaya Langsung" khusus tampilan cetak; totals.* tidak
	// diubah sehingga DPP & Grand Total tetap identik. totals.directTotal di
	// project-epi sudah termasuk item global_manpower (lihat calcQuotationTotals),
	// jadi tidak ada pemisahan Upah Tenaga Kerja seperti di dashboard admin.
	const biayaLangsungCetak =
		Number(totals.directTotal) +
		Number(totals.overhead) +
		Number(totals.margin) +
		Number(totals.komisi);
	const breakdown: [string, number][] = [
		['Subtotal Biaya Langsung', biayaLangsungCetak],
		['Mobilisasi', totals.mobilisasi],
		['Scaffolding / Perancah', totals.scaffolding],
		['Safety / APD', totals.safety]
	];
	if (totals.discount > 0) breakdown.push(['Diskon', -totals.discount]);
	breakdown.push(['Subtotal sebelum PPN (DPP)', totals.dpp]);
	if (totals.ppnPct > 0) breakdown.push([`PPN (${totals.ppnPct}%)`, totals.ppn]);

	const breakdownRows = breakdown.map(([label, val]) => [
		{ text: label, alignment: 'right', border: [false, false, false, false] },
		{ text: (val < 0 ? '-' : '') + formatRupiah(Math.abs(val)), alignment: 'right', border: [false, false, false, false] }
	]);

	const content: any[] = [
		{
			columns: [
				[
					{ text: COMPANY_NAME, style: 'company' },
					{ text: 'Coating & Corrosion Protection Specialist', style: 'muted' }
				],
				[
					{ text: 'PENAWARAN HARGA', style: 'docTitle', alignment: 'right' },
					{ text: header.nomor_penawaran || '-', alignment: 'right', bold: true, fontSize: 10 }
				]
			]
		},
		{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1 }], margin: [0, 8, 0, 10] },
		{
			columns: [
				[
					{ text: 'Kepada Yth.', style: 'muted' },
					{ text: header.customer_name || '-', bold: true, fontSize: 11 },
					header.kode_customer ? { text: `Kode: ${header.kode_customer}`, style: 'muted' } : {},
					header.lokasi ? { text: header.lokasi, fontSize: 9, margin: [0, 2, 0, 0] } : {}
				],
				[
					{ text: `Tanggal: ${formatTanggalId(header.tanggal)}`, alignment: 'right', fontSize: 9 },
					{ text: `Berlaku s/d: ${formatTanggalId(header.valid_until)}`, alignment: 'right', fontSize: 9 },
					header.project_name ? { text: `Project: ${header.project_name}`, alignment: 'right', fontSize: 9, margin: [0, 2, 0, 0] } : {}
				]
			],
			margin: [0, 0, 0, 12]
		},
		{
			table: { headerRows: 1, widths: [18, '*', 55, 75, 80], body: bodyRows },
			layout: {
				fillColor: (rowIndex: number) => (rowIndex === 0 ? '#f3f4f6' : null),
				hLineColor: () => '#d1d5db',
				vLineColor: () => '#d1d5db'
			}
		},
		{
			table: {
				widths: ['*', 110],
				body: [
					...breakdownRows,
					[
						{ text: 'GRAND TOTAL', alignment: 'right', bold: true, fontSize: 12, border: [false, true, false, false] },
						{ text: formatRupiah(totals.grandTotal), alignment: 'right', bold: true, fontSize: 12, border: [false, true, false, false] }
					]
				]
			},
			layout: { hLineColor: () => '#9ca3af', vLineColor: () => '#ffffff' },
			margin: [0, 10, 0, 0]
		}
	];

	if (header.total_area && Number(header.total_area) > 0) {
		content.push({
			text: `Total luas area: ${Number(header.total_area).toLocaleString('id-ID')} m²`,
			style: 'muted',
			margin: [0, 6, 0, 0]
		});
	}

	if (header.payment_terms?.trim()) {
		content.push({ text: 'Termin Pembayaran', style: 'sectionH' });
		content.push({ text: header.payment_terms.trim(), fontSize: 9 });
	}
	if (header.notes?.trim()) {
		content.push({ text: 'Catatan', style: 'sectionH' });
		content.push({ text: header.notes.trim(), fontSize: 9 });
	}
	if (header.terms?.trim()) {
		content.push({ text: 'Syarat & Ketentuan', style: 'sectionH' });
		content.push({ text: header.terms.trim(), fontSize: 9 });
	}

	content.push({
		columns: [
			{ text: '' },
			[
				{ text: 'Hormat kami,', fontSize: 9, alignment: 'center', margin: [0, 24, 0, 28] },
				{ text: header.prepared_by || '__________________', bold: true, fontSize: 10, alignment: 'center' },
				{ text: COMPANY_NAME, style: 'muted', alignment: 'center' }
			]
		],
		margin: [0, 20, 0, 0]
	});

	const docDefinition = {
		defaultStyle: { font: 'Helvetica', fontSize: 10 },
		pageMargins: [40, 40, 40, 40] as [number, number, number, number],
		content,
		styles: {
			company: { bold: true, fontSize: 15 },
			docTitle: { bold: true, fontSize: 13, color: '#374151' },
			muted: { fontSize: 8, color: '#6b7280' },
			th: { bold: true, fontSize: 9 },
			sectionH: { bold: true, fontSize: 10, margin: [0, 12, 0, 3] }
		}
	};

	const pdfDoc = printer.createPdfKitDocument(docDefinition);
	const chunks: Buffer[] = [];
	return new Promise((resolve, reject) => {
		pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
		pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
		pdfDoc.on('error', reject);
		pdfDoc.end();
	});
}
