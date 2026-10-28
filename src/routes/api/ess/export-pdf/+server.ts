// src/routes/api/ess/export-pdf/+server.ts
// POST { judul, subjudul?, kolom: string[], baris: (string|number|null)[][], watermark?, landscape? }
// → render tabel jadi PDF via Gotenberg (server) → binary PDF.
// Dipakai EssExportSheet.svelte di dashboard lapangan — nol beban bundle klien.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { htmlToPdf } from '$lib/server/gotenbergClient';
import { buildEssTablePdfHtml } from '$lib/pdf-templates/essTablePdf';

const MAX_ROWS = 5000; // pagar agar server tidak berat

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	let body: any;
	try {
		body = await event.request.json();
	} catch {
		throw error(400, 'Body JSON tidak valid.');
	}

	const judul = String(body?.judul || '').trim();
	const subjudul = body?.subjudul ? String(body.subjudul) : '';
	const watermark = body?.watermark ? String(body.watermark) : '';
	const landscape = body?.landscape === true;
	const kolom = Array.isArray(body?.kolom) ? body.kolom.map((k: unknown) => String(k)) : [];
	const barisRaw = Array.isArray(body?.baris) ? body.baris : [];

	if (!judul) throw error(400, 'judul wajib diisi.');
	if (!kolom.length) throw error(400, 'kolom wajib diisi.');
	if (barisRaw.length > MAX_ROWS) {
		throw error(413, `Terlalu banyak baris (maks ${MAX_ROWS}). Persempit filter/periode.`);
	}

	const baris = barisRaw.map((row: unknown) =>
		Array.isArray(row) ? row.map((c) => (c == null ? '' : c)) : [String(row ?? '')]
	);

	const html = buildEssTablePdfHtml({
		judul,
		subjudul,
		kolom,
		baris,
		watermark,
		dicetakOleh: karyawan.nama_karyawan || ''
	});

	try {
		const buffer = await htmlToPdf(html, { landscape, filename: 'ess-export.pdf' });
		const safe = judul.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
		return new Response(Uint8Array.from(buffer), {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `inline; filename="${safe}.pdf"`
			}
		});
	} catch (e: any) {
		console.error('[ess/export-pdf] gagal render:', e?.message);
		throw error(502, 'Layanan PDF sedang tidak tersedia. Coba lagi nanti atau gunakan CSV.');
	}
};

// Beri tahu klien kalau salah method
export const GET: RequestHandler = async () => json({ message: 'Gunakan POST.' }, { status: 405 });
