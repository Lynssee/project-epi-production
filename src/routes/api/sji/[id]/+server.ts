// src/routes/api/sji/[id]/+server.ts
// GET   -> detail satu SJI (header + item anak), hanya untuk pemilik (karyawan_id cocok).
// PATCH { action: 'cancel' } -> batalkan SJI, hanya bila status masih 'diajukan' dan milik sendiri.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { directusServerJson } from '$lib/server/directus';

async function resolveKaryawan(user: { localId: string; email: string }) {
	const byUid = await getKaryawanByFirebaseUid(user.localId).catch(() => null);
	if (byUid) return byUid;
	return resolveKaryawanByEmail(user.email);
}

async function loadHeaderWithItems(id: number) {
	const headerRes = await directusServerJson<{ data: any }>(
		`/items/sji_header/${id}?fields=id,reference_no,status,urgency,keperluan,catatan,karyawan_id,gudang_id.nama_gudang,approver,tanggal_approval,date_created`
	).catch(() => null);
	const header = headerRes?.data;
	if (!header) return null;

	const idsFilter = encodeURIComponent(JSON.stringify({ sji_header_id: { _eq: id } }));
	const [pbRes, piRes] = await Promise.all([
		directusServerJson<{ data: any[] }>(
			`/items/pengeluaran_barang?filter=${idsFilter}&fields=id,reference_no,item_id.nama_barang_lengkap,quantity,status,catatan&limit=-1`
		),
		directusServerJson<{ data: any[] }>(
			`/items/peminjaman_internal?filter=${idsFilter}&fields=id,reference_no,item_id.nama_barang_lengkap,quantity,status,tanggal_jatuh_tempo,tanggal_kembali_aktual,catatan&limit=-1`
		)
	]);

	const items = [
		...(pbRes?.data || []).map((r) => ({ ...r, tipe: 'ambil_pakai' as const, collection: 'pengeluaran_barang' })),
		...(piRes?.data || []).map((r) => ({ ...r, tipe: 'pinjam' as const, collection: 'peminjaman_internal' }))
	];

	return { header, items };
}

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	const id = Number(event.params.id);
	if (!Number.isFinite(id)) throw error(400, 'ID tidak valid.');

	const result = await loadHeaderWithItems(id);
	if (!result) throw error(404, 'SJI tidak ditemukan.');

	const ownerId =
		typeof result.header.karyawan_id === 'object' ? result.header.karyawan_id?.id : result.header.karyawan_id;
	if (ownerId !== karyawan.id) throw error(403, 'Anda tidak berhak melihat SJI ini.');

	return json(result);
};

export const PATCH: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	const id = Number(event.params.id);
	if (!Number.isFinite(id)) throw error(400, 'ID tidak valid.');

	const body = await event.request.json().catch(() => null);
	if (body?.action !== 'cancel') throw error(400, 'Aksi tidak dikenali.');

	const result = await loadHeaderWithItems(id);
	if (!result) throw error(404, 'SJI tidak ditemukan.');

	const ownerId =
		typeof result.header.karyawan_id === 'object' ? result.header.karyawan_id?.id : result.header.karyawan_id;
	if (ownerId !== karyawan.id) throw error(403, 'Anda tidak berhak membatalkan SJI ini.');
	if (result.header.status !== 'diajukan') {
		throw error(409, `SJI berstatus "${result.header.status}" tidak bisa dibatalkan lagi.`);
	}

	await directusServerJson(`/items/sji_header/${id}`, {
		method: 'PATCH',
		body: JSON.stringify({ status: 'dibatalkan' })
	});

	for (const it of result.items) {
		await directusServerJson(`/items/${it.collection}/${it.id}`, {
			method: 'PATCH',
			body: JSON.stringify({ status: 'ditolak', catatan: 'Dibatalkan oleh pemohon.' })
		}).catch(() => {});
	}

	return json({ success: true });
};
