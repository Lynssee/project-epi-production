// src/routes/api/export/produksi/+server.ts
// Export Produksi v2 — Fase 4 §6.4/§6.5.
// POST { section, judul, subjudul?, kolom: string[], baris: (string|number|null)[][], landscape? }
// → render tabel jadi PDF via Gotenberg (server) → binary PDF. Nol beban bundle klien.
//
// PENEGAKAN BERLAPIS (§6.5):
//  - `section` WAJIB ada di allow-list produksi lapangan → selain itu 403 + log,
//    meski payload direkayasa dari klien.
//  - Kolom yang tampak "harga" (harga/hpp/margin/rp/biaya/…) DIBUANG di sini —
//    data lapangan memang tak punya rupiah, ini pagar terakhir.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import QRCode from 'qrcode';
import { requireUser } from '$lib/server/firebaseAuth';
import { htmlToPdf } from '$lib/server/gotenbergClient';
import { buildProduksiTablePdfHtml } from '$lib/pdf-templates/produksiTablePdf';
import {
	isProduksiExportKey,
	isPriceColumn,
	PRODUKSI_EXPORT_SECTIONS
} from '$lib/config/produksiExportAllowlist';

const MAX_ROWS = 5000; // pagar agar server tidak berat

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);

	let body: any;
	try {
		body = await event.request.json();
	} catch {
		throw error(400, 'Body JSON tidak valid.');
	}

	const section = String(body?.section || '');
	if (!isProduksiExportKey(section)) {
		// §6.5.2 — tolak section rekayasa, catat.
		console.error(
			`[export/produksi] section tidak dikenal ditolak: "${section}" oleh ${user?.email || user?.localId || 'unknown'}`
		);
		throw error(403, 'Bagian export tidak dikenal.');
	}

	const judul = String(body?.judul || PRODUKSI_EXPORT_SECTIONS[section].label).trim();
	const subjudul = body?.subjudul ? String(body.subjudul) : '';
	const landscape = body?.landscape === true;

	let kolom = Array.isArray(body?.kolom) ? body.kolom.map((k: unknown) => String(k)) : [];
	let barisRaw = Array.isArray(body?.baris) ? body.baris : [];

	if (!kolom.length) throw error(400, 'kolom wajib diisi.');
	if (barisRaw.length > MAX_ROWS) {
		throw error(413, `Terlalu banyak baris (maks ${MAX_ROWS}). Persempit filter/periode.`);
	}

	// §6.5.3 — buang kolom "harga" beserta selnya, apa pun yang dikirim klien.
	const dropIdx = kolom
		.map((k: string, i: number) => (isPriceColumn(k) ? i : -1))
		.filter((i: number) => i >= 0);
	if (dropIdx.length) {
		const keep = (i: number) => !dropIdx.includes(i);
		kolom = kolom.filter((_: string, i: number) => keep(i));
		barisRaw = barisRaw.map((row: unknown) =>
			Array.isArray(row) ? row.filter((_, i) => keep(i)) : row
		);
	}

	const baris = barisRaw.map((row: unknown) =>
		Array.isArray(row) ? row.map((c) => (c == null ? '' : c)) : [String(row ?? '')]
	);

	// B2: QR verifikasi di header — mengarah ke halaman Monitoring Produksi live supaya
	// penerima bisa cek apakah PDF sudah kedaluwarsa. Non-fatal bila gagal digenerate.
	let qrDataUri = '';
	try {
		qrDataUri = await QRCode.toDataURL(`${event.url.origin}/produksi`, { width: 120, margin: 1 });
	} catch (e: any) {
		console.warn('[export/produksi] QR gagal digenerate (non-fatal):', e?.message);
	}

	const html = buildProduksiTablePdfHtml({
		judul,
		subjudul,
		kolom,
		baris,
		dicetakOleh: user?.email || '',
		qrDataUri
	});

	try {
		const buffer = await htmlToPdf(html, { landscape, filename: 'produksi-export.pdf' });
		const safe = judul.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'produksi-export';
		return new Response(Uint8Array.from(buffer), {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `inline; filename="${safe}.pdf"`
			}
		});
	} catch (e: any) {
		console.error('[export/produksi] gagal render PDF:', e?.message);
		throw error(502, 'Layanan PDF sedang tidak tersedia. Coba lagi nanti atau gunakan CSV.');
	}
};

export const GET: RequestHandler = async () => json({ message: 'Gunakan POST.' }, { status: 405 });
