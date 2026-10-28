// src/routes/api/sj-manual/+server.ts
// Fase 3 (Penajaman Surat Jalan Manual): pintu masuk lapangan. Identitas pemohon
// di-resolve SERVER-SIDE dari Firebase, sama seperti api/sji/+server.ts.
//
// GET  ?meta=1  -> config (enabled/requireScanUpload) + boleh-ajukan + proyek aktif.
// GET  (default) -> daftar SJ Manual milik pemohon yang login.
// POST -> ajukan SJ Manual baru.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { getSjManualConfig, canSubmitSjManual, submitSjManual } from '$lib/server/sjManualSubmit';
import type { SjManualItemInput } from '$lib/server/sjManualSubmit';
import { checkCreateBlockedByTunggakan } from '$lib/server/sjTunggakanServer';
import { SJ_MANUAL_TYPE, toLegacyHeader } from '$lib/server/sjManualFields';

async function resolveKaryawan(user: { localId: string; email: string }) {
	const byUid = await getKaryawanByFirebaseUid(user.localId).catch(() => null);
	if (byUid) return byUid;
	return resolveKaryawanByEmail(user.email);
}

/**
 * getKaryawanByFirebaseUid mengembalikan jabatan_id sebagai object ter-expand
 * ({id, nama_posisi}), tapi resolveKaryawanByEmail (fallback) mengembalikannya
 * sebagai id mentah (unwrapId) — normalisasi di sini supaya canSubmitSjManual
 * tidak diam-diam selalu gagal resolve nama_posisi lewat jalur fallback.
 */
async function resolveJabatanLabel(karyawan: any): Promise<string | null> {
	if (karyawan?.jabatan_id?.nama_posisi) return karyawan.jabatan_id.nama_posisi;
	const jabatanId = typeof karyawan?.jabatan_id === 'object' ? karyawan.jabatan_id?.id : karyawan?.jabatan_id;
	if (!jabatanId) return null;
	const res = await directusServerJson<{ data: any }>(`/items/posisi/${jabatanId}?fields=nama_posisi`).catch(() => null);
	return res?.data?.nama_posisi || null;
}

const PROYEK_LOKASI_STATUSES = ['on progress', 'repair', 'hold'];

async function getActiveProjects() {
	const filter = encodeURIComponent(JSON.stringify({ status: { _in: PROYEK_LOKASI_STATUSES } }));
	const res = await directusServerJson<{ data: any[] }>(
		`/items/projects?filter=${filter}&fields=id,name,lokasi&sort=name&limit=-1`
	);
	return res?.data || [];
}

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	if (event.url.searchParams.get('meta') === '1') {
		const [config, projects] = await Promise.all([getSjManualConfig(), getActiveProjects()]);
		const jabatanLabel = await resolveJabatanLabel(karyawan);
		return json({
			enabled: config.enabled,
			requireScanUpload: config.requireScanUpload,
			canSubmit: config.enabled && canSubmitSjManual(config, jabatanLabel),
			projects
		});
	}

	const searchQ = event.url.searchParams.get('search');
	if (searchQ != null) {
		const q = searchQ.trim();
		if (q.length < 2) return json({ data: [] });
		const filter = encodeURIComponent(JSON.stringify({ nama_barang_lengkap: { _icontains: q } }));
		const res = await directusServerJson<{ data: any[] }>(
			`/items/identitas_barang?filter=${filter}&fields=id,nama_barang_lengkap,satuan,stok_tersedia&limit=20`
		);
		return json({ data: res?.data || [] });
	}

	const filter = encodeURIComponent(JSON.stringify({ requested_by: { _eq: karyawan.id }, type: { _eq: SJ_MANUAL_TYPE } }));
	const res = await directusServerJson<{ data: any[] }>(
		`/items/surat_jalan?filter=${filter}&fields=id,nomor_sj,status,approval_status,notes,project_id.name,date_created&sort=-date_created&limit=-1`
	);
	return json({ data: (res?.data || []).map(toLegacyHeader) });
};

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	const config = await getSjManualConfig();
	if (!config.enabled) throw error(403, 'Pengajuan SJ Manual dari lapangan belum diaktifkan. Hubungi admin.');
	const jabatanLabel = await resolveJabatanLabel(karyawan);
	if (!canSubmitSjManual(config, jabatanLabel)) {
		throw error(403, 'Role Anda tidak diizinkan mengajukan SJ Manual. Hubungi admin.');
	}

	// Penajaman Gate SJ: tunggakan berkas fisik menahan pengajuan baru (hanya bila gate berstatus HARD; soft/shadow = banner saja).
	const tunggakanBlock = await checkCreateBlockedByTunggakan(karyawan.id);
	if (tunggakanBlock) throw error(422, tunggakanBlock);

	const form = await event.request.formData();
	const body = JSON.parse(String(form.get('payload') || '{}'));
	const customerName: string = (body?.customerName || '').trim();
	const customerAddress: string = (body?.customerAddress || '').trim();
	const items: SjManualItemInput[] = Array.isArray(body?.items) ? body.items : [];

	if (!customerName) throw error(400, 'Tujuan pengiriman wajib diisi.');
	if (!customerAddress) throw error(400, 'Alamat tujuan wajib diisi.');
	if (items.length === 0) throw error(400, 'Minimal satu item harus diajukan.');
	for (const it of items) {
		if (!it.namaBarang || !(Number(it.qty) > 0)) throw error(400, 'Item tidak valid — nama barang & qty wajib diisi.');
	}

	const scanFile = form.get('scanFile');
	if (config.requireScanUpload && !(scanFile instanceof File)) {
		throw error(400, 'Scan dokumen wajib diupload sesuai pengaturan admin.');
	}
	const [scanFileId, fotoFileId] = await Promise.all([
		uploadIfFile(form.get('scanFile'), 'scan-sj-manual'),
		uploadIfFile(form.get('fotoFile'), 'foto-sj-manual')
	]);

	const result = await submitSjManual({
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
};

async function uploadIfFile(entry: FormDataEntryValue | null, description: string): Promise<string | null> {
	if (!(entry instanceof File) || entry.size === 0) return null;
	const fd = new FormData();
	fd.append('file', entry, entry.name || `${description}.jpg`);
	fd.append('description', description);
	const res = await directusServerUpload(fd);
	if (!res.ok) {
		console.warn(`[api/sj-manual] gagal upload ${description}:`, await res.text().catch(() => ''));
		return null;
	}
	const data = await res.json().catch(() => null);
	return data?.data?.id || null;
}
