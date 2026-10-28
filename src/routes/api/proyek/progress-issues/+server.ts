// src/routes/api/proyek/progress-issues/+server.ts
// SPL-01/02 — penanda dashboard lapangan: GET ?ids=1,2,3 → { [projectId]: { message, created_at } } untuk proyek
// yang punya notifikasi "konflik/yatim progres" BELUM selesai (app_notifications type=project_progress_sync_issue,
// read != true). Notifikasi dibuat & ditutup oleh sinkron progres di erp-epi (projectProgressNotify.js).
// SATU query ber-_in (bukan per kartu). Read-only; hanya perlu login (pesan tidak memuat data sensitif).
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';

const EVENT = 'project_progress_sync_issue';
const MAX_IDS = 100;

export const GET: RequestHandler = async (event) => {
	await requireUser(event);
	const raw = event.url.searchParams.get('ids') || '';
	const ids = [...new Set(raw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0))];
	if (ids.length === 0) return json({});
	if (ids.length > MAX_IDS) throw error(400, `Maksimal ${MAX_IDS} id per permintaan.`);

	const filter = encodeURIComponent(
		JSON.stringify({
			_and: [
				{ type: { _eq: EVENT } },
				{ read: { _neq: true } },
				{ source_collection: { _eq: 'projects' } },
				{ source_id: { _in: ids.map(String) } }
			]
		})
	);
	try {
		const res = await directusServerJson(
			`/items/app_notifications?filter=${filter}&fields=id,source_id,message,created_at&sort=id&limit=-1`
		);
		const out: Record<number, { message: string; created_at: string }> = {};
		for (const r of res?.data || []) out[Number(r.source_id)] = { message: r.message, created_at: r.created_at };
		return json(out);
	} catch (e) {
		console.error('[api/proyek/progress-issues] Gagal memuat notifikasi masalah progres:', e);
		throw error(502, 'Gagal memuat penanda masalah progres.');
	}
};
