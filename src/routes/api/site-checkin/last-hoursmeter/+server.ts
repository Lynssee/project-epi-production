// src/routes/api/site-checkin/last-hoursmeter/+server.ts
// Paket 09 Site Visit Release §2.6 — hour meter checkout maintenance dibandingkan dengan
// catatan TERAKHIR untuk equipment yang sama (query terpisah, Aturan #2), supaya mekanik
// diperingatkan bila mengetik angka yang lebih kecil dari sebelumnya (typo/salah unit).

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);
	const workOrderId = event.url.searchParams.get('workOrderId');
	if (!workOrderId) throw error(400, 'workOrderId wajib diisi.');

	// Query terpisah (Aturan #2) — jangan `equipment_id.name`/nested di sini.
	const woRes = await directusServerJson<{ data: { equipment_id: string | null } | null }>(
		`/items/work_order/${workOrderId}?fields=equipment_id`
	).catch(() => null);
	const equipmentId = woRes?.data?.equipment_id || null;
	if (!equipmentId) return json({ hoursmeter: null, tanggalInput: null });

	const query = new URLSearchParams({
		'filter[equipment_id][_eq]': equipmentId,
		'filter[hoursmeter][_nnull]': 'true',
		fields: 'hoursmeter,tanggal_input',
		sort: '-tanggal_input',
		limit: '1'
	});
	const res = await directusServerJson<{ data: { hoursmeter: number | null; tanggal_input: string }[] }>(
		`/items/mekanik_activity?${query.toString()}`
	).catch((e) => {
		console.error('[last-hoursmeter] gagal memuat catatan hoursmeter terakhir:', e);
		return null;
	});
	const last = res?.data?.[0] || null;
	return json({ hoursmeter: last?.hoursmeter ?? null, tanggalInput: last?.tanggal_input ?? null });
};
