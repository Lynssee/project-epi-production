// src/routes/api/ga-ruangan/lapor/+server.ts
// Lapor 1 barang (rusak / pindah / hilang) tanpa sesi cek kelengkapan penuh —
// Barang per Ruangan via QR Patroli, Fase 4. 'rusak' -> tiket Service Desk GA
// otomatis (keputusan Lead 10 Sep 2026), selain itu movement menunggu_konfirmasi.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { directusServerJson } from '$lib/server/directus';
import { getRoomMeta } from '$lib/server/gaRuanganMeta';
import { recordAssetIssue, type StatusBaris } from '$lib/server/gaAssetIssue';

async function resolveKaryawan(user: { localId: string; email: string }) {
	const byUid = await getKaryawanByFirebaseUid(user.localId).catch(() => null);
	if (byUid) return byUid;
	return resolveKaryawanByEmail(user.email);
}

const JENIS_TO_STATUS: Record<string, Exclude<StatusBaris, 'ada'>> = {
	rusak: 'rusak',
	pindah: 'tidak_ada',
	hilang: 'tidak_ada'
};

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);
	if (!karyawan) throw error(403, 'Data karyawan tidak ditemukan untuk akun ini.');

	const body = await event.request.json().catch(() => null);
	const assetId = Number(body?.asset_id);
	const jenis = String(body?.jenis || '');
	if (!Number.isInteger(assetId) || assetId <= 0) throw error(400, 'asset_id wajib diisi.');
	if (!JENIS_TO_STATUS[jenis]) throw error(400, 'jenis harus rusak / pindah / hilang.');

	const assetRes = await directusServerJson<{ data: any }>(`/items/ga_asset/${assetId}?fields=id,nama,area_id`);
	const asset = assetRes?.data;
	if (!asset) throw error(404, 'Barang tidak ditemukan.');
	if (!asset.area_id) throw error(400, 'Barang tidak tertaut ke ruangan.');

	const meta = await getRoomMeta(Number(asset.area_id));
	const areaName = meta?.area_name || `Ruangan #${asset.area_id}`;

	const { movementId, ticketId } = await recordAssetIssue({
		areaId: Number(asset.area_id),
		areaName,
		assetId,
		assetNama: asset.nama || `Barang #${assetId}`,
		status: JENIS_TO_STATUS[jenis],
		qtyAktual: body?.qty != null ? Number(body.qty) : null,
		catatan: body?.catatan ? String(body.catatan) : null,
		foto: body?.foto ? String(body.foto) : null,
		karyawan,
		roomCheckId: null,
		sumber: 'lapangan'
	});

	return json({ ok: true, movement_id: movementId, ticket_id: ticketId });
};
