// src/routes/api/pengajuan-anggaran-reevaluate/+server.ts
// Fase 3 (Rencana v2 Shift-Left Gate Anggaran, 25 Sep 2026) — proxy "Cek Ulang" ke
// admin erp-epi-1 (/api/pengajuan/re-evaluate). Pola sama persis dengan
// api/pengajuan-preflight/+server.ts (auth Firebase diteruskan apa adanya, project
// sama di kedua repo, P4 — satu otoritas mesin gate per keputusan).
//
// Beda dari preflight: ini aksi eksplisit milik user (tombol "Cek Ulang" di layar
// detail PA), bukan pra-cek diam-diam — jadi kegagalan TIDAK fail-soft ke "tetap
// bisa lanjut", melainkan dikembalikan sebagai error supaya UI bisa menampilkannya.

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function POST(event: RequestEvent) {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) {
		throw error(503, 'Cek Ulang belum dikonfigurasi (ERP_EPI1_BASE_URL kosong).');
	}

	const body = await event.request.json().catch(() => ({}));
	if (!body?.pengajuan_id) throw error(400, 'pengajuan_id wajib');
	const authHeader = event.request.headers.get('authorization') || '';

	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/pengajuan/re-evaluate`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: authHeader },
			body: JSON.stringify({ pengajuan_id: body.pengajuan_id }),
			signal: AbortSignal.timeout(15000)
		});
		const result = await res.json().catch(() => ({}));
		if (!res.ok) {
			throw error(res.status, result?.message || 'Cek Ulang gagal — coba lagi.');
		}
		return json(result);
	} catch (e: any) {
		if (e?.status) throw e; // sudah SvelteKit error() di atas
		console.warn('[pengajuan-anggaran-reevaluate] gagal menghubungi admin:', e?.message);
		throw error(502, 'Tidak dapat menghubungi admin saat ini — coba lagi sebentar lagi.');
	}
}
