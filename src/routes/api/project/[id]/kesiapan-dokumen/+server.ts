// src/routes/api/project/[id]/kesiapan-dokumen/+server.ts
// Proxy server-side kesiapan DOKUMEN proyek (kalibrasi alat & sertifikasi personel) dari erp-epi —
// Rencana Expired Date v2 Fase 5. Pola sama proxy fulfillment. Upstream tak terjangkau = 'na' yang JUJUR
// ("belum bisa dimuat"), bukan merah: checklist lapangan tidak boleh terhukum oleh gangguan layanan.
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

	const id = event.params.id || '';
	if (!/^\d+$/.test(id)) return json({ error: 'ID proyek tidak valid.' }, { status: 400 });
	const baseUrl = env.ERP_EPI1_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://internal.eltamaprimaindo.com' : 'http://localhost:9390');
	const authHeader = event.request.headers.get('authorization') || '';

	try {
		const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/project/${id}/kesiapan-dokumen${event.url.search || ''}`, {
			headers: { Authorization: authHeader, Accept: 'application/json' },
			signal: AbortSignal.timeout(10000)
		});
		if (res.ok) return json(await res.json());
		console.warn(`[kesiapan-dokumen proxy] Upstream status ${res.status} untuk proyek ${id}`);
	} catch (err: any) {
		console.warn(`[kesiapan-dokumen proxy] Upstream tak terjangkau untuk proyek ${id}:`, err?.message || err);
	}

	const na = { state: 'na', detail: 'Data belum bisa dimuat dari server pusat. Coba lagi nanti.', items: [] };
	return json({ projectId: Number(id), today: new Date().toISOString().slice(0, 10), alat: na, personel: na, sumber_gagal: ['upstream'], syncedAt: new Date().toISOString() });
}
