// src/routes/api/packing-list/apd-basics/+server.ts
// Bahan kartu "APD Tim" form Packing List lapangan (Rencana Keyakinan Permintaan PL, Fase 3): kebutuhan APD (penugasan aktif × aturan jabatan)
// + APD yang sudah dikomit/diterima di site. Satu panggilan per proyek; form menilai sendiri di browser. Hanya baca & informatif.
//   GET ?project_id=123 → { success, persons, need[], min_coverage_pct, committed[], siteReceived[] }
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';
import { loadFieldApd } from '$lib/server/plApdFieldLoader';

export async function GET(event: RequestEvent) {
	await requireUser(event);
	const projectId = event.url.searchParams.get('project_id');
	if (!projectId || !/^\d+$/.test(projectId)) return json({ success: false, error: 'project_id wajib (angka)' }, { status: 400 });
	try {
		return json({ success: true, ...(await loadFieldApd(projectId, directusServerJson as any)) });
	} catch (e: any) {
		console.error(`[packing-list/apd-basics] proyek ${projectId} gagal:`, e?.message || e);
		return json({ success: false, error: 'Gagal memuat bahan kebutuhan APD' }, { status: 500 });
	}
}
