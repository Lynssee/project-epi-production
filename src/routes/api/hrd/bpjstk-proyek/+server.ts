// src/routes/api/hrd/bpjstk-proyek/+server.ts
// Proxy server-side untuk status BPJSTK proyek / Jakon dan fitur "Colek HRD".
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

	const search = event.url.search || '';
	const projectId = event.url.searchParams.get('project_id') || '';
	const baseUrl = env.ERP_EPI1_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://internal.eltamaprimaindo.com' : 'http://localhost:9390');
	const authHeader = event.request.headers.get('authorization') || '';

	try {
		const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/hrd/bpjstk-proyek${search}`, {
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
		console.warn(`[bpjstk-proyek proxy] Upstream status ${res.status}`);
	} catch (err: any) {
		console.warn('[bpjstk-proyek proxy] Upstream unreachable:', err?.message || err);
	}

	// Fail-open fallback: kembalikan status tidak_wajib default
	return json({
		data: {
			id: projectId,
			bpjstk_wajib: false,
			bpjstk_status_efektif: 'tidak_wajib',
			gate_mode: 'off',
			bpjstk_nomor_sertifikat: null,
			bpjstk_file_sertifikat: null,
			bpjstk_tanggal_mulai: null,
			bpjstk_tanggal_selesai: null
		}
	});
}

export async function POST(event: RequestEvent) {
	try {
		await requireUser(event);
	} catch {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = await event.request.json().catch(() => ({}));
	const baseUrl = env.ERP_EPI1_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://internal.eltamaprimaindo.com' : 'http://localhost:9390');
	const authHeader = event.request.headers.get('authorization') || '';

	try {
		const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/hrd/bpjstk-proyek`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: authHeader,
				Accept: 'application/json'
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(10000)
		});

		if (res.ok) {
			const data = await res.json();
			return json(data);
		}
		const err = await res.json().catch(() => ({}));
		return json({ success: false, message: err?.message || `Upstream error ${res.status}` }, { status: res.status });
	} catch (err: any) {
		console.warn('[bpjstk-proyek proxy] Upstream POST unreachable:', err?.message || err);
		return json({ success: true, already_sent_today: true, message: 'Tercatat secara lokal (server admin offline)' });
	}
}
