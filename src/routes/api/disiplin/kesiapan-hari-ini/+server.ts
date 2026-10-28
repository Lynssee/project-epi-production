// src/routes/api/disiplin/kesiapan-hari-ini/+server.ts
// Proxy server-side untuk cek kesiapan harian lapangan (P2H, Visit, Dokumen Jalan, Retur).
// Mencegah client-side browser memanggil langsung ke origin eksternal.
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function GET(event: RequestEvent) {
	try {
		await requireUser(event);
	} catch {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const baseUrl = env.ERP_EPI1_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://internal.eltamaprimaindo.com' : 'http://localhost:9390');
	const authHeader = event.request.headers.get('authorization') || '';

	try {
		const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/disiplin/kesiapan-hari-ini`, {
			headers: {
				Authorization: authHeader,
				Accept: 'application/json'
			},
			signal: AbortSignal.timeout(10000)
		});

		if (res.ok) {
			const data = await res.json();
			return json(data);
		}
		console.warn(`[disiplin proxy] Upstream status ${res.status}`);
	} catch (err: any) {
		console.warn('[disiplin proxy] Upstream unreachable:', err?.message || err);
	}

	// Fail-open fallback: kembalikan struktur aman agar widget tidak error
	const today = new Date().toISOString().slice(0, 10);
	return json({
		success: true,
		tanggal: today,
		profile: { wajib_visit: false, wajib_p2h: false, wajib_dokumen_jalan: false, pola_kerja: null },
		p2h: { applicable: false, ok: true, detail: 'Data P2H belum disinkronkan' },
		visit: { applicable: false, ok: true, detail: 'Data Visit belum disinkronkan' },
		dokumen_jalan: { applicable: false, ok: true, detail: 'Data Dokumen Jalan belum disinkronkan' },
		retur: { applicable: false, ok: true, detail: 'Data Retur belum disinkronkan' }
	});
}
