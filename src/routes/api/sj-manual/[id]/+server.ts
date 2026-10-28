// src/routes/api/sj-manual/[id]/+server.ts
// Detail + cancel SJ Manual milik pemohon yang login. Kepemilikan diverifikasi
// server-side lewat requested_by == karyawan.id (identitas dari Firebase),
// bukan dari parameter klien.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { resubmitSjManual } from '$lib/server/sjManualSubmit';
import type { SjManualItemInput } from '$lib/server/sjManualSubmit';
import { SJ_MANUAL_TYPE, toLegacyHeader, fromSuratJalanItemRows } from '$lib/server/sjManualFields';

async function resolveKaryawan(user: { localId: string; email: string }) {
	const byUid = await getKaryawanByFirebaseUid(user.localId).catch(() => null);
	if (byUid) return byUid;
	return resolveKaryawanByEmail(user.email);
}

async function loadOwned(id: string, karyawanId: number) {
	const res = await directusServerJson<{ data: any }>(`/items/surat_jalan/${id}?fields=*`);
	const sj = res?.data;
	if (!sj || sj.type !== SJ_MANUAL_TYPE || sj.requested_by !== karyawanId) return null;
	return sj;
}

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	const sj = await loadOwned(event.params.id!, karyawan.id);
	if (!sj) throw error(404, 'SJ Manual tidak ditemukan');

	const itemRes = await directusServerJson<{ data: any[] }>(
		`/items/surat_jalan_items?filter[surat_jalan_id][_eq]=${sj.id}&fields=id,nama_barang,qty_required,unit,keterangan&sort=id&limit=-1`
	).catch(() => ({ data: [] as any[] }));
	const items = fromSuratJalanItemRows(itemRes?.data || []);

	const actions = await getApprovalActions(sj.id);

	return json({ header: toLegacyHeader(sj), items, actions });
};

async function getApprovalActions(sjId: number): Promise<any[]> {
	const reqFilter = encodeURIComponent(
		JSON.stringify({ source_collection: { _eq: 'surat_jalan' }, source_id: { _eq: String(sjId) } })
	);
	const reqRes = await directusServerJson<{ data: any[] }>(
		`/items/approval_requests?filter=${reqFilter}&sort=-date_created&limit=1&fields=id`
	).catch(() => ({ data: [] }));
	const requestId = reqRes?.data?.[0]?.id;
	if (!requestId) return [];

	const actionsRes = await directusServerJson<{ data: any[] }>(
		`/items/approval_actions?filter[request_id][_eq]=${encodeURIComponent(requestId)}&sort=date_created&fields=*`
	).catch(() => ({ data: [] }));
	return actionsRes?.data || [];
}

async function uploadIfFile(entry: FormDataEntryValue | null, description: string): Promise<string | null> {
	if (!(entry instanceof File) || entry.size === 0) return null;
	const fd = new FormData();
	fd.append('file', entry, entry.name || `${description}.jpg`);
	fd.append('description', description);
	const res = await directusServerUpload(fd);
	if (!res.ok) {
		console.warn(`[api/sj-manual/[id]] gagal upload ${description}:`, await res.text().catch(() => ''));
		return null;
	}
	const data = await res.json().catch(() => null);
	return data?.data?.id || null;
}

export const PATCH: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	const sj = await loadOwned(event.params.id!, karyawan.id);
	if (!sj) throw error(404, 'SJ Manual tidak ditemukan');

	const contentType = event.request.headers.get('content-type') || '';

	if (contentType.includes('multipart/form-data')) {
		// Revisi & ajukan ulang SJ yang ditolak.
		const form = await event.request.formData();
		if (String(form.get('action')) !== 'resubmit') throw error(400, 'Aksi tidak dikenal');

		const body = JSON.parse(String(form.get('payload') || '{}'));
		const customerName: string = (body?.customerName || '').trim();
		const customerAddress: string = (body?.customerAddress || '').trim();
		const items: SjManualItemInput[] = Array.isArray(body?.items) ? body.items : [];
		if (!customerName) throw error(400, 'Tujuan pengiriman wajib diisi.');
		if (!customerAddress) throw error(400, 'Alamat tujuan wajib diisi.');
		if (items.length === 0) throw error(400, 'Minimal satu item harus diajukan.');

		const [scanFileId, fotoFileId] = await Promise.all([
			uploadIfFile(form.get('scanFile'), 'scan-sj-manual'),
			uploadIfFile(form.get('fotoFile'), 'foto-sj-manual')
		]);

		const result = await resubmitSjManual({
			sjId: sj.id,
			karyawanId: karyawan.id,
			karyawanNama: karyawan.nama_karyawan || 'Karyawan',
			karyawanDivisi: karyawan.divisi || null,
			customerName,
			customerAddress,
			customerPhone: body?.customerPhone,
			projectId: body?.projectId ? Number(body.projectId) : null,
			driverName: body?.driverName,
			notes: body?.notes,
			items,
			scanFileId,
			fotoFileId
		});
		return json({ success: true, ...result });
	}

	const body = await event.request.json().catch(() => ({}));
	if (body?.action !== 'cancel') throw error(400, 'Aksi tidak dikenal');
	if (sj.approval_status === 'disetujui') {
		throw error(400, 'SJ yang sudah disetujui tidak bisa dibatalkan dari sini — hubungi admin.');
	}

	await directusServerJson(`/items/surat_jalan/${sj.id}`, {
		method: 'PATCH',
		body: JSON.stringify({ status: 'cancelled', approval_status: 'ditolak' })
	});

	return json({ success: true });
};
