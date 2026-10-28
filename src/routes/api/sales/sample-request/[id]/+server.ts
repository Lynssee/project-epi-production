// src/routes/api/sales/sample-request/[id]/+server.ts
// SI-TAMA Sales §7 — detail & transisi status Request Sample Cat.
//   GET   : detail satu request
//   PATCH : { action } -> submit | edit | approve | reject | mark_process | mark_sent | mark_done
// approve/reject butuh permission `approve_sample_request`; submit/edit hanya pemilik;
// mark_* boleh pemilik atau pemegang permission.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { getUserPermissions, hasAnyPermission } from '$lib/server/rbacServer';
import { directusServerJson } from '$lib/server/directus';

const COL = 'sales_sample_request';
const READ_FIELDS = [
	'id', 'nomor_request', 'tanggal', 'status', 'sales_id', 'sales_id.nama_karyawan',
	'customer_id', 'customer_id.nama_sj_fp', 'customer_id.kode_customer', 'customer_name',
	'prospect_id', 'produk_cat', 'warna', 'ukuran_sample', 'jumlah', 'tujuan', 'kategori', 'keterangan',
	'approved_by', 'approved_by.nama_karyawan', 'approved_at', 'catatan_approver',
	'tanggal_kirim', 'foto_bukti', 'date_created', 'date_updated',
	// Fase 6.3 (rencana lifecycle produksi v2, 15 Sep 2026): feedback customer setelah terkirim.
	'sumber_pemenuhan', 'feedback_hasil', 'feedback_catatan'
].join(',');

async function resolveKaryawan(user: { localId: string; email: string }) {
	const byUid = await getKaryawanByFirebaseUid(user.localId).catch(() => null);
	if (byUid) return byUid;
	return resolveKaryawanByEmail(user.email);
}

async function loadRow(id: number) {
	const res = await directusServerJson<{ data: any }>(
		`/items/${COL}/${id}?fields=${READ_FIELDS}`
	).catch(() => null);
	return res?.data || null;
}

function idOf(v: any): number | null {
	if (v == null) return null;
	return typeof v === 'object' ? Number(v.id) : Number(v);
}

export const GET: RequestHandler = async (event) => {
	await requireUser(event);
	const id = Number(event.params.id);
	if (!Number.isFinite(id)) throw error(400, 'ID tidak valid.');
	const row = await loadRow(id);
	if (!row) throw error(404, 'Request sample tidak ditemukan.');
	return json({ data: row });
};

export const PATCH: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);
	if (!karyawan?.id) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	const id = Number(event.params.id);
	if (!Number.isFinite(id)) throw error(400, 'ID tidak valid.');

	const body = await event.request.json().catch(() => null);
	const action = body?.action as string;
	if (!action) throw error(400, 'action wajib diisi.');

	const row = await loadRow(id);
	if (!row) throw error(404, 'Request sample tidak ditemukan.');

	const isOwner = idOf(row.sales_id) === karyawan.id;
	const now = new Date().toISOString();
	let canApprove = false;
	if (action === 'approve' || action === 'reject') {
		const perm = await getUserPermissions(
			(event.request.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''),
			user.localId
		);
		canApprove = hasAnyPermission(perm.permissions, ['approve_sample_request', 'super_admin']);
		if (!canApprove) throw error(403, 'Anda tidak berhak menyetujui/menolak request sample.');
	}

	let patch: Record<string, any> = {};

	switch (action) {
		case 'submit':
			if (!isOwner) throw error(403, 'Hanya pengaju yang bisa mengirim request ini.');
			if (row.status !== 'draft') throw error(400, 'Request sudah dikirim.');
			patch = { status: 'menunggu_approval' };
			break;

		case 'edit': {
			if (!isOwner) throw error(403, 'Hanya pengaju yang bisa mengubah request ini.');
			if (!['draft', 'menunggu_approval'].includes(row.status))
				throw error(400, 'Request yang sudah diproses tidak bisa diubah.');
			const f = body.fields || {};
			for (const k of ['produk_cat', 'warna', 'ukuran_sample', 'jumlah', 'tujuan', 'kategori', 'keterangan', 'customer_id', 'customer_name', 'prospect_id', 'tanggal']) {
				if (k in f) patch[k] = f[k] === '' ? null : f[k];
			}
			if ('jumlah' in patch) patch.jumlah = Number(patch.jumlah) > 0 ? Number(patch.jumlah) : 1;
			break;
		}

		case 'approve':
			if (row.status !== 'menunggu_approval') throw error(400, 'Request tidak dalam status menunggu approval.');
			patch = {
				status: 'disetujui',
				approved_by: karyawan.id,
				approved_at: now,
				catatan_approver: body.catatan?.trim() || null
			};
			break;

		case 'reject':
			if (row.status !== 'menunggu_approval') throw error(400, 'Request tidak dalam status menunggu approval.');
			patch = {
				status: 'ditolak',
				approved_by: karyawan.id,
				approved_at: now,
				catatan_approver: body.catatan?.trim() || null
			};
			break;

		case 'mark_process':
			if (!isOwner && !canApprove) throw error(403, 'Tidak berhak.');
			if (row.status !== 'disetujui') throw error(400, 'Request belum disetujui.');
			patch = { status: 'dalam_proses' };
			break;

		case 'mark_sent':
			if (!isOwner && !canApprove) throw error(403, 'Tidak berhak.');
			if (!['disetujui', 'dalam_proses'].includes(row.status)) throw error(400, 'Status tidak valid untuk pengiriman.');
			patch = {
				status: 'terkirim',
				tanggal_kirim: body.tanggal_kirim || now.slice(0, 10),
				foto_bukti: body.foto_bukti || row.foto_bukti || null
			};
			break;

		case 'mark_done':
			if (!isOwner && !canApprove) throw error(403, 'Tidak berhak.');
			if (row.status !== 'terkirim') throw error(400, 'Request belum terkirim.');
			patch = { status: 'selesai' };
			break;

		// Fase 6.3: feedback customer WAJIB dicatat sales setelah sample terkirim (diterima/
		// revisi/ditolak). 'revisi' bisa ditindaklanjuti admin jadi proyek R&D (erp-epi,
		// createRndProjectFromSample) -- di sini hanya mencatat, tidak membuat proyek.
		case 'feedback': {
			if (!isOwner) throw error(403, 'Hanya pengaju yang bisa mencatat feedback customer.');
			if (!['terkirim', 'selesai'].includes(row.status)) throw error(400, 'Feedback hanya bisa dicatat setelah sample terkirim.');
			const hasil = body.feedback_hasil;
			if (!['diterima', 'revisi', 'ditolak'].includes(hasil)) throw error(400, 'feedback_hasil tidak valid.');
			patch = {
				feedback_hasil: hasil,
				feedback_catatan: body.feedback_catatan?.trim() || null
			};
			break;
		}

		default:
			throw error(400, `Aksi "${action}" tidak dikenali.`);
	}

	await directusServerJson(`/items/${COL}/${id}`, {
		method: 'PATCH',
		body: JSON.stringify(patch)
	});

	return json({ data: await loadRow(id) });
};
