// src/routes/api/maintenance/export-pdf/+server.ts
// POST { judul, subjudul?, kolom: string[], baris: (string|number|null)[][], watermark?, landscape? }
// → render tabel jadi PDF via Gotenberg (server) → binary PDF.
// Dipakai FieldExportSheet.svelte di 5 halaman Maintenance/Preventive lapangan
// (Fase 4 "Export Maintenance v2" rencana) — nol beban bundle klien.
//
// Auth: requireUser() (generik, siapa saja yang login) — BUKAN authenticateProjectLeaderForEquipment
// atau authenticateEss (terlalu sempit/khusus modul lain). Halaman pemanggil (work-order,
// riwayat-unit, P2H, PM) sudah membatasi data lewat query per-operator/per-equipment sendiri;
// endpoint ini hanya merender tabel yang DIOPER klien, tidak query Directus sendiri.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { htmlToPdf } from '$lib/server/gotenbergClient';
import { buildFieldTablePdfHtml } from '$lib/pdf-templates/fieldTablePdf';

const MAX_ROWS = 5000; // pagar agar server tidak berat

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);

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

	const html = buildFieldTablePdfHtml({
		judul,
		subjudul,
		kolom,
		baris,
		watermark,
		dicetakOleh: user.email || ''
	});

	try {
		const buffer = await htmlToPdf(html, { landscape, filename: 'maintenance-export.pdf' });
		const safe = judul.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
		return new Response(Uint8Array.from(buffer), {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `inline; filename="${safe}.pdf"`
			}
		});
	} catch (e: any) {
		console.error('[maintenance/export-pdf] gagal render:', e?.message);
		throw error(502, 'Layanan PDF sedang tidak tersedia. Coba lagi nanti atau gunakan CSV.');
	}
};

// Beri tahu klien kalau salah method
export const GET: RequestHandler = async () => json({ message: 'Gunakan POST.' }, { status: 405 });
