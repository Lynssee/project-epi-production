// src/routes/api/ga-ruangan/[areaId]/barang/+server.ts
// Sensus & koreksi barang sebuah ruangan (Barang per Ruangan via QR Patroli, Fase 3).
//   POST  -> tambah 1 barang ke ruangan
//   PATCH -> ubah qty / qty_rusak / kondisi 1 barang
// Identitas pencatat di-resolve SERVER-SIDE dari Firebase (pola sama /api/stock-lapangan/
// cek-area & /api/sji). Otorisasi `kelola_aset_ruangan` digerbangi di klien (form
// disembunyikan) — pola yang sama, bukan pelonggaran baru.
// Server menurunkan `lokasi_id` (site) dari area -> zone -> location agar KPI lama
// (ga_asset_utilization) tidak berubah, dan mencatat ga_asset_movement sumber='sensus'.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { directusServerJson } from '$lib/server/directus';
import { getRoomMeta, clearRoomMetaCache } from '$lib/server/gaRuanganMeta';
import { getGaAsetSettings } from '$lib/server/gaAsetSettings';

async function resolveKaryawan(user: { localId: string; email: string }) {
	const byUid = await getKaryawanByFirebaseUid(user.localId).catch(() => null);
	if (byUid) return byUid;
	return resolveKaryawanByEmail(user.email);
}

const KONDISI = new Set(['baik', 'perlu_perbaikan', 'rusak']);
const KATEGORI = new Set(['perabotan', 'elektronik', 'peralatan', 'lainnya']);

/** Site (ga_locations.id) dari area lewat zone. null bila area tanpa zona. */
async function deriveLokasiId(areaId: number): Promise<number | null> {
	const meta = await getRoomMeta(areaId);
	return meta?.location_id ?? null;
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
	const nama = String(body?.nama || '').trim();
	const identitasId = body?.identitas_barang_id != null ? Number(body.identitas_barang_id) : null;
	const kategori = String(body?.kategori || 'lainnya');
	const modeLacak = body?.mode_lacak === 'kolektif' ? 'kolektif' : 'unit';
	const qty = modeLacak === 'kolektif' ? Math.max(1, Number(body?.qty) || 1) : 1;
	const qtyRusak = Math.min(qty, Math.max(0, Number(body?.qty_rusak) || 0));
	const kondisi = KONDISI.has(body?.kondisi) ? body.kondisi : 'baik';
	const foto = body?.foto ? String(body.foto) : null;
	const catatan = body?.catatan ? String(body.catatan) : null;

	if (!nama && identitasId == null) throw error(400, 'Nama barang atau katalog wajib diisi.');
	if (!KATEGORI.has(kategori)) throw error(400, 'Kategori tidak valid.');

	const settings = await getGaAsetSettings();
	if (!settings.izinkanBarangTanpaKatalog && identitasId == null) {
		throw error(400, 'Barang harus dipilih dari katalog identitas_barang.');
	}

	const lokasiId = await deriveLokasiId(areaId);

	// Buat aset.
	const created = await directusServerJson<{ data: any }>(`/items/ga_asset`, {
		method: 'POST',
		body: JSON.stringify({
			nama: nama || null,
			kategori,
			area_id: areaId,
			lokasi_id: lokasiId,
			qty,
			qty_rusak: qtyRusak,
			mode_lacak: modeLacak,
			kondisi,
			status: 'aktif',
			identitas_barang_id: identitasId,
			foto,
			catatan
		})
	});
	const asset = created?.data;

	// Jejak sensus (movement). Kegagalan di sini TIDAK membatalkan aset — log jelas.
	try {
		await directusServerJson(`/items/ga_asset_movement`, {
			method: 'POST',
			body: JSON.stringify({
				asset_id: asset?.id,
				tipe: 'opname',
				sumber: 'sensus',
				status: 'tercatat',
				ke_area_id: areaId,
				ke: meta.area_name,
				qty,
				kondisi,
				oleh_id: karyawan.id,
				tanggal: new Date().toISOString(),
				catatan: 'Sensus barang ruangan'
			})
		});
	} catch (err) {
		console.error(`[ga-ruangan/barang] gagal catat movement sensus aset ${asset?.id}:`, err);
	}

	clearRoomMetaCache();
	return json({ ok: true, asset });
};

export const PATCH: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);
	if (!karyawan) throw error(403, 'Data karyawan tidak ditemukan untuk akun ini.');

	const areaId = Number(event.params.areaId);
	const body = await event.request.json().catch(() => null);
	const assetId = Number(body?.asset_id);
	if (!Number.isInteger(assetId) || assetId <= 0) throw error(400, 'asset_id wajib diisi.');

	// Pastikan aset memang di ruangan ini (anti-lintas-ruangan).
	const cur = await directusServerJson<{ data: any }>(
		`/items/ga_asset/${assetId}?fields=id,area_id,qty,mode_lacak`
	);
	if (!cur?.data) throw error(404, 'Barang tidak ditemukan.');
	if (Number(cur.data.area_id) !== areaId) throw error(400, 'Barang bukan milik ruangan ini.');

	const patch: Record<string, unknown> = {};
	if (body?.qty != null && cur.data.mode_lacak === 'kolektif') {
		patch.qty = Math.max(1, Number(body.qty) || 1);
	}
	if (body?.qty_rusak != null) {
		const cap = Number(patch.qty ?? cur.data.qty ?? 1);
		patch.qty_rusak = Math.min(cap, Math.max(0, Number(body.qty_rusak) || 0));
	}
	if (body?.kondisi != null) {
		if (!KONDISI.has(body.kondisi)) throw error(400, 'Kondisi tidak valid.');
		patch.kondisi = body.kondisi;
	}
	if (Object.keys(patch).length === 0) throw error(400, 'Tidak ada perubahan.');

	const updated = await directusServerJson<{ data: any }>(`/items/ga_asset/${assetId}`, {
		method: 'PATCH',
		body: JSON.stringify(patch)
	});

	try {
		await directusServerJson(`/items/ga_asset_movement`, {
			method: 'POST',
			body: JSON.stringify({
				asset_id: assetId,
				tipe: 'opname',
				sumber: 'sensus',
				status: 'tercatat',
				ke_area_id: areaId,
				qty: patch.qty ?? cur.data.qty ?? 1,
				kondisi: patch.kondisi ?? undefined,
				oleh_id: karyawan.id,
				tanggal: new Date().toISOString(),
				catatan: 'Koreksi sensus (qty/kondisi)'
			})
		});
	} catch (err) {
		console.error(`[ga-ruangan/barang] gagal catat movement koreksi aset ${assetId}:`, err);
	}

	return json({ ok: true, asset: updated?.data });
};
