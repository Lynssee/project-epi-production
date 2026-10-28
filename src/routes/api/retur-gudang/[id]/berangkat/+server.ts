// src/routes/api/retur-gudang/[id]/berangkat/+server.ts
// RSM-01 §4.1 — leader/sopir di site mengonfirmasi barang retur berangkat (draft → dikirim).
// Idempoten; otorisasi = leader proyek pemilik dokumen (authenticateProjectLeader).

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { authenticateProjectLeader } from '$lib/server/projectLeaderGuard';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';
import { markReturBerangkat } from '$lib/server/returGudangServer';

export async function POST(event: RequestEvent) {
	const id = Number(event.params.id);
	if (!Number.isFinite(id) || id <= 0) throw error(400, 'ID dokumen retur tidak valid');

	// Header dibaca dulu untuk tahu proyeknya — kepemilikan divalidasi dari data server, bukan body.
	const head = await directusServerJson<{ data: { project_id: number | null } }>(`/items/retur_gudang/${id}?fields=project_id`)
		.then((r) => r?.data)
		.catch(() => null);
	if (!head?.project_id) throw error(404, 'Dokumen retur tidak ditemukan');
	const { karyawan } = await authenticateProjectLeader(event, Number(head.project_id));
	const fbUser = await requireUser(event);

	const body = await event.request.json().catch(() => ({}));
	const lat = Number(body?.gps?.lat);
	const lng = Number(body?.gps?.lng);

	try {
		const result = await markReturBerangkat(id, {
			fotoKirim: Array.isArray(body?.fotoKirim) ? body.fotoKirim : [],
			driverName: body?.driverName ? String(body.driverName).slice(0, 120) : null,
			vehiclePlate: body?.vehiclePlate ? String(body.vehiclePlate).slice(0, 30) : null,
			gps: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
			actorName: karyawan.nama_karyawan,
			actorUid: fbUser.localId
		});
		return json({ success: true, data: result });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal menandai dokumen retur berangkat');
	}
}
