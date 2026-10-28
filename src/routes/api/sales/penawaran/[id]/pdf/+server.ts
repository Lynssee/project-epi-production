// src/routes/api/sales/penawaran/[id]/pdf/+server.ts
// SI-TAMA Sales §5b — generate PDF penawaran harga on-demand.
// Auth Firebase biasa (requireUser). Render server-side (pdfmake, lihat
// lib/server/penawaranPdf.ts) — binary PDF dikembalikan langsung, tidak diunggah
// ke Directus. Frontend memanggil via fetch ber-Authorization lalu memicu unduh Blob.

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { fetchPenawaran } from '$lib/server/penawaranExport';
import { buildPenawaranPdfBuffer } from '$lib/server/penawaranPdf';

export const GET: RequestHandler = async (event) => {
	await requireUser(event);

	const id = event.params.id;
	if (!id) throw error(400, 'ID penawaran wajib.');

	const data = await fetchPenawaran(id);
	if (!data) throw error(404, 'Penawaran tidak ditemukan.');

	try {
		const buffer = await buildPenawaranPdfBuffer(data.header, data.items);
		const safeNo = (data.header.nomor_penawaran || `penawaran-${id}`).replace(/[^\w.-]+/g, '-');
		return new Response(Uint8Array.from(buffer), {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="${safeNo}.pdf"`
			}
		});
	} catch (e: any) {
		console.error('[penawaran/pdf] gagal render PDF:', e?.message);
		throw error(500, e?.message || 'Gagal membuat PDF.');
	}
};
