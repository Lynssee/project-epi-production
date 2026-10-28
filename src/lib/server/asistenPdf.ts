// src/lib/server/asistenPdf.ts
// SERVER-ONLY. Export PDF percakapan Asisten AI lapangan — Fase 4, implementation_
// plan_asisten_ai_v2.md §4: "Lapangan: jangan tambah ~200 KB lib ke bundle mobile
// tanpa alasan. Pilih server-side... Markdown lapangan safe by construction -> aman
// di-render." Render di Node murni pakai pdfmake (pola sama dengan
// lib/server/laporanPdf.js di erp-epi-1, dipakai endpoint render-pdf n8n di sana) —
// BUKAN Puppeteer/browser headless (infrastruktur tak tersedia di repo ini), dan
// TIDAK menambah apa pun ke bundle klien (import ada di file +server.ts saja).

const FONTS = {
	Helvetica: {
		normal: 'Helvetica',
		bold: 'Helvetica-Bold',
		italics: 'Helvetica-Oblique',
		bolditalics: 'Helvetica-BoldOblique'
	}
};

const COMPANY_NAME = 'PT Eltama Prima Indo';

// Markdown ringan -> plain text (BUKAN HTML — "safe by construction" di sini berarti
// tidak ada suntikan markup, cukup buang syntax markdown supaya PDF tetap terbaca).
function stripMarkdown(src: string): string {
	return String(src ?? '')
		.replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ''))
		.replace(/`([^`\n]+)`/g, '$1')
		.replace(/\*\*([^*]+)\*\*/g, '$1')
		.replace(/\*([^*]+)\*/g, '$1')
		.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/^\s*[-*]\s+/gm, '• ');
}

export interface AsistenPdfMessage {
	role: 'user' | 'assistant';
	content: string;
}

export async function buildAsistenPdfBuffer(messages: AsistenPdfMessage[]): Promise<Buffer> {
	// Tipe modul di pdfmake.d.ts (ambient) — @types/pdfmake resmi typing API browser,
	// bukan export Node "printer" yang sungguh dipakai di sini (lihat komentar di sana).
	const PdfPrinter = (await import('pdfmake')).default;
	const printer = new PdfPrinter(FONTS);

	const content: any[] = [
		{ text: COMPANY_NAME, bold: true, fontSize: 14, alignment: 'center' },
		{ text: 'Percakapan Asisten AI — Lapangan', fontSize: 12, alignment: 'center', margin: [0, 2, 0, 0] },
		{ text: new Date().toLocaleString('id-ID'), fontSize: 9, color: '#6b7280', alignment: 'center', margin: [0, 4, 0, 12] },
		{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1 }], margin: [0, 0, 0, 12] }
	];

	for (const m of messages) {
		if (!m?.content?.trim()) continue;
		const label = m.role === 'user' ? 'Anda' : 'Asisten AI';
		content.push({ text: label, bold: true, fontSize: 9, color: m.role === 'user' ? '#0e7490' : '#374151', margin: [0, 8, 0, 2] });
		content.push({ text: stripMarkdown(m.content), fontSize: 10, margin: [0, 0, 0, 0] });
	}

	if (content.length === 4) {
		content.push({ text: 'Belum ada percakapan.', italics: true, color: '#9ca3af', margin: [0, 8, 0, 0] });
	}

	const docDefinition = {
		defaultStyle: { font: 'Helvetica', fontSize: 10 },
		pageMargins: [40, 50, 40, 40] as [number, number, number, number],
		content
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
