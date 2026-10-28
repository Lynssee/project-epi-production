// src/routes/api/project/rap-seed/+server.ts
// Fase 3 (Sales B2B PO/RAP v2) — relay seeding RAP otomatis ke admin erp-epi-1
// (/api/project/rap-seed). Logika seeding sengaja HANYA hidup di satu tempat
// (rapSeeder.js, erp-epi-1) — endpoint ini murni penerus, sama pola dengan
// /api/pengajuan-preflight.
//
// Auth: kedua repo berbagi Firebase project yang sama — token ID Firebase
// pemanggil diteruskan apa adanya.
//
// BEDA dengan pengajuan-preflight: ini aksi tulis yang ditunggu user (bukan cek
// pasif), jadi kegagalan dilaporkan apa adanya (bukan fail-soft 200).

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function POST(event: RequestEvent) {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) {
		throw error(503, 'Seeding RAP belum dikonfigurasi (ERP_EPI1_BASE_URL kosong di server project-epi).');
	}

	const body = await event.request.json().catch(() => ({}));
	const authHeader = event.request.headers.get('authorization') || '';

	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/project/rap-seed`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: authHeader },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(15000)
		});
		const result = await res.json().catch(() => ({}));
		if (!res.ok) {
			throw error(res.status, result?.message || 'Gagal seed RAP di admin.');
		}
		return json(result);
	} catch (e: any) {
		if (e?.status) throw e; // sudah SvelteKit error di atas
		console.warn('[rap-seed relay] gagal menghubungi admin:', e?.message);
		throw error(502, 'Tidak dapat menghubungi admin erp-epi-1 saat ini.');
	}
}
