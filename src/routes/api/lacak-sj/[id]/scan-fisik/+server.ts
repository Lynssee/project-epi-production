// src/routes/api/lacak-sj/[id]/scan-fisik/+server.ts
// Penajaman Gate SJ Fase 3: unggah foto lembar SJ fisik bertanda tangan lengkap (scan_sj_file) dari HP.
// Hanya driver SJ / anggota proyek terkait (aturan sama dengan GET /api/lacak-sj/[id]) dan hanya setelah
// barang sampai di tujuan. Menimpa scan sebelumnya diperbolehkan (foto ulang bila buram).
//   POST multipart: file=<image>  -> { success, file_id }

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { authenticateLacakActor } from '$lib/server/sjVerifikasiAkses';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { resolveDriverIdentity, isSjDriver } from '$lib/server/driverIdentity';
import { TUNGGAKAN_RECEIVED_STAGES } from '$lib/shared/sjTunggakanFisik';

const MAX_BYTES = 12 * 1024 * 1024;

export const POST: RequestHandler = async (event) => {
	const aktor = await authenticateLacakActor(event);
	const id = Number(event.params.id);
	if (!Number.isFinite(id)) throw error(400, 'id tidak valid.');

	const sj = (await directusServerJson<{ data: any }>(
		`/items/surat_jalan/${id}?fields=id,nomor_sj,project_id,driver,delegated_driver_id,delegated_user_id,track_stage,received_at`
	).catch(() => null))?.data;
	if (!sj) throw error(404, 'Surat Jalan tidak ditemukan.');

	const projId = typeof sj.project_id === 'object' ? sj.project_id?.id : sj.project_id;
	const isMyProject = projId != null && aktor.projectIds.includes(Number(projId));
	const isDriver = isSjDriver(sj, await resolveDriverIdentity(aktor.karyawan));
	if (!isMyProject && !isDriver) throw error(403, 'SJ ini tidak berkaitan dengan Anda.');

	const sudahSampai = !!sj.received_at || (TUNGGAKAN_RECEIVED_STAGES as readonly string[]).includes(String(sj.track_stage));
	if (!sudahSampai) throw error(409, 'Foto SJ fisik baru bisa diunggah setelah barang tiba di lokasi.');

	const form = await event.request.formData();
	const file = form.get('file');
	if (!(file instanceof File) || file.size === 0) throw error(400, 'Foto SJ wajib dilampirkan.');
	if (!file.type.startsWith('image/')) throw error(400, 'File harus berupa foto.');
	if (file.size > MAX_BYTES) throw error(413, 'Foto terlalu besar (maks 12 MB).');

	const fd = new FormData();
	fd.append('file', file, file.name || `scan-sj-${id}.jpg`);
	fd.append('description', `scan-sj-fisik ${sj.nomor_sj || id}`);
	const up = await directusServerUpload(fd);
	if (!up.ok) {
		console.error('[api/lacak-sj/scan-fisik] upload gagal:', await up.text().catch(() => ''));
		throw error(502, 'Gagal mengunggah foto. Coba lagi.');
	}
	const fileId = (await up.json().catch(() => null))?.data?.id;
	if (!fileId) throw error(502, 'Upload berhasil tapi ID file tidak ditemukan.');

	await directusServerJson(`/items/surat_jalan/${id}`, { method: 'PATCH', body: JSON.stringify({ scan_sj_file: fileId }) });
	return json({ success: true, file_id: fileId });
};
