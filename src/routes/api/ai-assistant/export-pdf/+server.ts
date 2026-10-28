// src/routes/api/ai-assistant/export-pdf/+server.ts
// Endpoint privat: export percakapan Asisten AI lapangan ke PDF — Fase 4 (§4).
// Dipanggil langsung oleh AsistenSheet.svelte saat pengguna menekan tombol export
// (on-demand, bukan dipicu n8n) — auth Firebase biasa (requireUser), BUKAN shared
// secret seperti api/laporan/render-pdf (itu endpoint privat lain, dipicu workflow
// terjadwal, jadi tidak punya sesi user). Render server-side (pdfmake, lihat
// lib/server/asistenPdf.ts) — binary PDF dikembalikan langsung, tidak diunggah ke
// Directus (sekali pakai, bukan dokumen yang perlu disimpan).

import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { buildAsistenPdfBuffer, type AsistenPdfMessage } from '$lib/server/asistenPdf';

const MAX_MESSAGES = 200;

export async function POST(event: RequestEvent) {
	await requireUser(event);

	let body: any;
	try {
		body = await event.request.json();
	} catch {
		throw error(400, 'Body harus JSON');
	}

	const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
	const messages: AsistenPdfMessage[] = rawMessages
		.filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
		.slice(0, MAX_MESSAGES)
		.map((m: any) => ({ role: m.role, content: m.content }));

	try {
		const buffer = await buildAsistenPdfBuffer(messages);
		// Uint8Array.from() menyalin ke ArrayBuffer baru — BodyInit di lib TS DOM
		// terbaru tidak menerima Buffer langsung (sama isu dengan aiAttachments.ts).
		return new Response(Uint8Array.from(buffer), {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="percakapan-asisten-ai-${Date.now()}.pdf"`
			}
		});
	} catch (e: any) {
		console.error('[ai-assistant/export-pdf] gagal render PDF:', e?.message);
		throw error(500, e?.message || 'Gagal membuat PDF.');
	}
}
