// src/routes/api/sales/field-report/pdf/+server.ts
// Export & PDF Modul Sales v2 — Fase 6 §9.2 (PDF lapangan).
// POST { title, subtitle?, columns: string[], rows: (string|number)[][], meta? }
//   → HTML tabel ber-kop → Gotenberg (htmlToPdf) → binary PDF.
// Auth Firebase (requireUser). Gotenberg opsional: bila tak terjangkau → 503
// dengan pesan jelas; klien lapangan otomatis jatuh ke CSV.
//
// Pertahanan berlapis (§9.2 "ditolak di server"): kolom apa pun yang header-nya
// menyerupai harga/margin/HPP DIBUANG di sini, bukan hanya disembunyikan di UI.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { htmlToPdf } from '$lib/server/gotenbergClient';

const COMPANY = 'PT Eltama Prima Indo';
const PRICE_RE = /(harga|margin|markup|hpp|cogs|nilai|omzet|amount|total_nilai|grand_total|subtotal|rupiah|rp\b)/i;

function esc(v: unknown): string {
	return String(v ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function buildHtml(
	title: string,
	subtitle: string,
	columns: string[],
	rows: unknown[][],
	meta: Record<string, unknown>
): string {
	const now = new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
	const dicetakOleh = esc((meta?.dicetak_oleh as string) || '-');
	const thead = columns.map((c) => `<th>${esc(c)}</th>`).join('');
	const tbody = rows
		.map(
			(r) =>
				`<tr>${columns
					.map((_, i) => `<td class="${i === 0 ? 'l' : ''}">${esc(r[i])}</td>`)
					.join('')}</tr>`
		)
		.join('');
	return `<!doctype html><html lang="id"><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#0f172a;padding:24px;font-size:11px}
.kop{text-align:center;border-bottom:2px solid #0f172a;padding-bottom:8px;margin-bottom:10px}
.kop b{font-size:15px}
h1{font-size:12px;text-align:center;margin:8px 0 2px;text-transform:uppercase}
.sub{font-size:9px;color:#475569;text-align:center;margin-bottom:10px}
table{width:100%;border-collapse:collapse}
th,td{border:1px solid #cbd5e1;padding:4px 6px;text-align:right}
th{background:#f1f5f9;font-size:9px;text-transform:uppercase;letter-spacing:.02em}
td.l,th:first-child{text-align:left}
tr:nth-child(even) td{background:#f8fafc}
.ft{margin-top:14px;padding-top:6px;border-top:1px solid #e2e8f0;font-size:8px;color:#94a3b8;text-align:right}
</style></head><body>
<div class="kop"><b>${esc(COMPANY)}</b><div style="font-size:8px;color:#64748b">Dashboard Lapangan — Sales</div></div>
<h1>${esc(title)}</h1>
${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}
<table><thead><tr>${thead}</tr></thead><tbody>${tbody || `<tr><td colspan="${columns.length}">Tidak ada data.</td></tr>`}</tbody></table>
<div class="ft">${rows.length} baris · Dicetak oleh ${dicetakOleh} — ${now} · Tanpa nilai rupiah</div>
</body></html>`;
}

export const POST: RequestHandler = async (event) => {
	await requireUser(event);

	let body: {
		title?: string;
		subtitle?: string;
		columns?: unknown;
		rows?: unknown;
		meta?: Record<string, unknown>;
	};
	try {
		body = await event.request.json();
	} catch {
		throw error(400, 'Body JSON tidak valid.');
	}

	const rawCols = Array.isArray(body.columns) ? body.columns.map((c) => String(c)) : [];
	const rawRows = Array.isArray(body.rows) ? (body.rows as unknown[][]) : [];
	if (rawCols.length === 0 || rawRows.length === 0) {
		throw error(400, 'columns & rows wajib diisi.');
	}

	// Buang kolom sensitif (index yang header-nya menyerupai harga/nilai).
	const keepIdx = rawCols.map((c, i) => (PRICE_RE.test(c) ? -1 : i)).filter((i) => i >= 0);
	const columns = keepIdx.map((i) => rawCols[i]);
	const rows = rawRows.map((r) => keepIdx.map((i) => r?.[i] ?? ''));

	const title = String(body.title || 'Laporan Sales Lapangan').slice(0, 120);
	const subtitle = String(body.subtitle || '').slice(0, 200);
	const html = buildHtml(title, subtitle, columns, rows, body.meta || {});

	try {
		const pdf = await htmlToPdf(html, { filename: 'field-report.html', landscape: columns.length > 6 });
		const safe = title.replace(/[^\w.-]+/g, '-').slice(0, 60) || 'laporan';
		return new Response(Uint8Array.from(pdf), {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="${safe}.pdf"`
			}
		});
	} catch (e) {
		console.error('[field-report/pdf] Gotenberg gagal:', (e as Error)?.message);
		// 503 → klien lapangan otomatis fallback ke CSV.
		return json(
			{ error: 'Layanan PDF (Gotenberg) sedang tidak tersedia. Gunakan CSV.' },
			{ status: 503 }
		);
	}
};
