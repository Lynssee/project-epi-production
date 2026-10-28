// src/routes/api/gates/perubahan-terbaru/+server.ts
// L1 (Rencana Pertajam ERP, 12 Okt 2026) — proxy tipis ke GET /api/gates/perubahan-terbaru milik admin erp-epi-1:
// daftar KENAIKAN keketatan mode gate beberapa hari terakhir, untuk banner "Aturan gate berubah" di lapangan.
// Pola sama pengajuan-preflight: requireUser() lokal, token diteruskan apa adanya, fail-soft mutlak (TIDAK pernah 500).
//
//   GET /api/gates/perubahan-terbaru?days=7 -> { available, changes: [...] }
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function GET(event: RequestEvent) {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) return json({ available: false, changes: [] });

	const days = Math.min(Math.max(Number(event.url.searchParams.get('days')) || 7, 1), 30);
	const authHeader = event.request.headers.get('authorization') || '';

	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/gates/perubahan-terbaru?days=${days}`, {
			headers: { Authorization: authHeader },
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) return json({ available: false, changes: [] });
		const data = await res.json().catch(() => ({ changes: [] }));
		return json({ available: true, changes: Array.isArray(data?.changes) ? data.changes : [] });
	} catch (e: any) {
		console.warn('[gates/perubahan-terbaru] gagal menghubungi admin:', e?.message);
		return json({ available: false, changes: [] });
	}
}
