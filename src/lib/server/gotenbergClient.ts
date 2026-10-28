// src/lib/server/gotenbergClient.ts
// ⚠️ SERVER-ONLY. Wrapper tipis ke Gotenberg (HTML→PDF via Chromium, MIT license).
// Fase 6 open-source plan ("Download PDF laporan sendiri", lapangan) — Gotenberg
// jalan SATU instance di VPS yang sama (bind 127.0.0.1:3001), dipakai bersama oleh
// erp-epi-1 (admin) DAN project-epi (lapangan) ini — tidak perlu instance terpisah,
// cukup GOTENBERG_URL yang sama di kedua .env karena keduanya proses server-side
// di VPS yang sama, bukan panggilan lintas-origin dari browser.

import { env } from '$env/dynamic/private';

const GOTENBERG_URL = env.GOTENBERG_URL || 'http://127.0.0.1:3001';

export async function htmlToPdf(
	html: string,
	opts: { landscape?: boolean; filename?: string } = {}
): Promise<Buffer> {
	const { landscape = false, filename = 'index.html' } = opts;
	const form = new FormData();
	form.append('files', new Blob([html], { type: 'text/html' }), filename);
	form.append('landscape', String(landscape));

	const res = await fetch(`${GOTENBERG_URL}/forms/chromium/convert/html`, {
		method: 'POST',
		body: form
	});

	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`Gotenberg ${res.status}: ${text || 'gagal render PDF'}`);
	}

	return Buffer.from(await res.arrayBuffer());
}
