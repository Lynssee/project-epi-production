// src/routes/api/ga-ruangan/[areaId]/cek/+server.ts
// Cek Kelengkapan Ruangan (Barang per Ruangan via QR Patroli, Fase 4). Header
// ga_room_check + movement HANYA untuk baris selisih (tabel tetap ramping, §4.3).
// Idempoten via client_event_id (kirim ulang offline tidak dobel). GPS informasi
// saja -- TIDAK memblokir (Aturan anti-lockdown retroaktif / gate aman).

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { directusServerJson } from '$lib/server/directus';
import { getRoomMeta, clearRoomMetaCache } from '$lib/server/gaRuanganMeta';
import { recordAssetIssue, type StatusBaris } from '$lib/server/gaAssetIssue';

async function resolveKaryawan(user: { localId: string; email: string }) {
	const byUid = await getKaryawanByFirebaseUid(user.localId).catch(() => null);
	if (byUid) return byUid;
	return resolveKaryawanByEmail(user.email);
}

interface HasilBaris {
	asset_id: number;
	status: StatusBaris;
	qty_aktual?: number | null;
	catatan?: string | null;
}

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);
	if (!karyawan) throw error(403, 'Data karyawan tidak ditemukan untuk akun ini.');

	const areaId = Number(event.params.areaId);
	if (!Number.isInteger(areaId) || areaId <= 0) throw error(400, 'ID ruangan tidak valid.');

	const meta = await getRoomMeta(areaId);
	if (!meta) throw error(404, 'Ruangan tidak ditemukan.');

	const body = await event.request.json().catch(() => null);
	const clientEventId = String(body?.client_event_id || '').trim();
	if (!clientEventId) throw error(400, 'client_event_id wajib diisi.');

	const hasil: HasilBaris[] = Array.isArray(body?.hasil) ? body.hasil : [];
	if (hasil.length === 0) throw error(400, 'Hasil cek kosong.');

	const checkpointId = body?.checkpoint_id != null ? Number(body.checkpoint_id) : null;
	const lat = body?.lat != null ? Number(body.lat) : null;
	const lng = body?.lng != null ? Number(body.lng) : null;
	const foto = body?.foto ? String(body.foto) : null;
	const catatanUmum = body?.catatan ? String(body.catatan) : null;

	// Idempotensi: kirim ulang client_event_id yang sama mengembalikan hasil lama,
	// tidak membuat baris ga_room_check kedua.
	const existing = await directusServerJson<{ data: any[] }>(
		`/items/ga_room_check?filter[client_event_id][_eq]=${encodeURIComponent(clientEventId)}&limit=1`
	);
	if (existing?.data?.[0]) {
		return json({ ok: true, room_check: existing.data[0], idempotent: true });
	}

	// GPS informasi saja -- tidak pernah memblokir submit (gate aman, shadow).
	let inRadius = true;
	if (checkpointId && lat != null && lng != null) {
		try {
			const cpRes = await directusServerJson<{ data: any }>(`/items/security_checkpoint/${checkpointId}?fields=lat,lng`);
			const cp = cpRes?.data;
			if (cp?.lat != null && cp?.lng != null) {
				const R = 6371000;
				const dLat = ((lat - cp.lat) * Math.PI) / 180;
				const dLng = ((lng - cp.lng) * Math.PI) / 180;
				const a =
					Math.sin(dLat / 2) ** 2 +
					Math.cos((cp.lat * Math.PI) / 180) * Math.cos((lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
				const distM = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
				inRadius = distM <= 150;
			}
		} catch (err) {
			console.error(`[ga-ruangan/cek] gagal cek radius checkpoint ${checkpointId}:`, err);
		}
	}

	const jmlSelisih = hasil.filter((h) => h.status !== 'ada').length;

	// Header cek kelengkapan dulu (supaya room_check_id ada untuk movement selisih).
	const rc = await directusServerJson<{ data: any }>(`/items/ga_room_check`, {
		method: 'POST',
		body: JSON.stringify({
			area_id: areaId,
			checkpoint_id: checkpointId,
			checked_by: karyawan.id,
			waktu: new Date().toISOString(),
			lat,
			lng,
			in_radius: inRadius,
			total_item: hasil.length,
			jml_cocok: hasil.length - jmlSelisih,
			jml_selisih: jmlSelisih,
			hasil,
			foto,
			catatan: catatanUmum,
			source: 'lapangan',
			client_event_id: clientEventId
		})
	});
	const roomCheckId = rc?.data?.id ?? null;

	// Baris 'ada' -> update last_checked_at/by. Baris selisih -> movement + (rusak) tiket.
	for (const row of hasil) {
		if (!row?.asset_id) continue;
		if (row.status === 'ada') {
			try {
				await directusServerJson(`/items/ga_asset/${row.asset_id}`, {
					method: 'PATCH',
					body: JSON.stringify({ last_checked_at: new Date().toISOString(), last_checked_by: karyawan.id })
				});
			} catch (err) {
				console.error(`[ga-ruangan/cek] gagal update last_checked aset ${row.asset_id}:`, err);
			}
			continue;
		}
		const assetRes = await directusServerJson<{ data: any }>(`/items/ga_asset/${row.asset_id}?fields=id,nama`).catch((err) => {
			console.error(`[ga-ruangan/cek] gagal baca nama aset ${row.asset_id}:`, err);
			return null;
		});
		await recordAssetIssue({
			areaId,
			areaName: meta.area_name,
			assetId: row.asset_id,
			assetNama: assetRes?.data?.nama || `Barang #${row.asset_id}`,
			status: row.status,
			qtyAktual: row.qty_aktual ?? null,
			catatan: row.catatan ?? null,
			foto,
			karyawan,
			roomCheckId,
			sumber: 'cek_ruangan'
		});
	}

	clearRoomMetaCache();
	return json({ ok: true, room_check: rc?.data, idempotent: false });
};
