// src/routes/api/project/[id]/fulfillment/+server.ts
// Proxy server-side untuk status kesiapan realisasi subtask proyek (PRJ-Fulfillment).
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
	const search = event.url.search || '';
	const baseUrl = env.ERP_EPI1_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://internal.eltamaprimaindo.com' : 'http://localhost:9390');
	const authHeader = event.request.headers.get('authorization') || '';

	try {
		const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/project/${id}/fulfillment${search}`, {
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
		console.warn(`[fulfillment proxy] Upstream status ${res.status} for project ${id}`);
	} catch (err: any) {
		console.warn(`[fulfillment proxy] Upstream unreachable for project ${id}:`, err?.message || err);
	}

	const today = new Date().toISOString().slice(0, 10);
	return json({
		projectId: Number(id) || 0,
		today,
		forecastEmpty: true,
		bySubtask: {},
		subtasks: [],
		manpowerToday: { roles: [] },
		syncedAt: new Date().toISOString()
	});
}
