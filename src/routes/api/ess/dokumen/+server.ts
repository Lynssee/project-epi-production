import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';

const DOKUMEN_FIELDS = [
	'id', 'tipe_dokumen', 'nama_dokumen', 'tanggal_upload', 'tanggal_berlaku', 'tanggal_expired',
	'status', 'notes', 'is_confidential', 'file_id'
].join(',');

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawan.id),
		fields: DOKUMEN_FIELDS,
		sort: '-tanggal_upload',
		limit: '-1'
	});

	const result = await directusServerJson<{ data: any[] }>(`/items/karyawan_dokumen?${query.toString()}`);

	return json({ dokumen: result?.data || [] });
};

// Tipe dokumen yang boleh diunggah mandiri oleh karyawan — dibatasi ke dokumen milik pribadi
// (KTP/KK/NPWP/dst). Dokumen resmi terbitan HR (kontrak, SK, NDA, offering letter, surat sanksi)
// SENGAJA tidak dibuka di sini agar tidak bisa ditimpa/dipalsukan karyawan; itu tetap lewat
// Generator Dokumen HR di erp-epi-1.
const SELF_UPLOAD_TYPES: Record<string, { label: string; folder: string | null }> = {
	ktp: { label: 'KTP', folder: '36b95b83-a16e-42a9-90ca-cc34529e8d86' },
	kk: { label: 'KK', folder: 'b9ffc41a-5605-4b52-b2cb-6fe1e85463c8' },
	npwp: { label: 'NPWP', folder: '64ddc0ce-0bbe-4480-8dd3-b843307dd2c5' },
	pas_foto: { label: 'Pas Foto', folder: 'a376b413-db33-4d38-bb32-24d5ae77c136' },
	ijazah: { label: 'Ijazah', folder: '461eaecc-fba3-445d-87a3-7ff8d270e5ab' },
	bpjs: { label: 'BPJS', folder: 'f2e80893-3b5b-4f1d-b045-74d0898720b6' },
	sertifikat: { label: 'Sertifikat', folder: '87f9817d-d4a1-4051-9165-4ef481dc779f' }
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const form = await event.request.formData();
	const tipeDokumen = form.get('tipe_dokumen')?.toString() || '';
	const file = form.get('file');

	const tipe = SELF_UPLOAD_TYPES[tipeDokumen];
	if (!tipe) throw error(400, 'Jenis dokumen tidak valid untuk unggah mandiri.');
	if (!(file instanceof File) || file.size === 0) throw error(400, 'File wajib diunggah.');
	if (file.size > MAX_FILE_SIZE) throw error(400, 'Ukuran file maksimal 10MB.');

	const uploadForm = new FormData();
	if (tipe.folder) uploadForm.append('folder', tipe.folder);
	uploadForm.append('file', file, file.name);

	const uploadRes = await directusServerUpload(uploadForm);
	if (!uploadRes.ok) throw error(502, 'Gagal mengunggah file ke penyimpanan.');
	const uploaded = await uploadRes.json();
	const fileId = uploaded?.data?.id;
	if (!fileId) throw error(502, 'Gagal mengunggah file ke penyimpanan.');

	let created: { data: any };
	try {
		created = await directusServerJson<{ data: any }>('/items/karyawan_dokumen', {
			method: 'POST',
			body: JSON.stringify({
				karyawan_id: karyawan.id,
				tipe_dokumen: tipeDokumen,
				nama_dokumen: `${tipe.label} - ${karyawan.nama_karyawan}`,
				file_id: { create: [{ directus_files_id: fileId }], delete: [] },
				tanggal_upload: new Date().toISOString(),
				status: 'active',
				notes: 'Diunggah mandiri oleh karyawan via aplikasi lapangan',
				is_confidential: false,
				is_encrypted: false,
				uploaded_by: karyawan.nama_karyawan || ''
			})
		});
	} catch (e) {
		try {
			await directusServerJson(`/files/${fileId}`, { method: 'DELETE' });
		} catch (_) {}
		throw error(502, (e as Error).message || 'Gagal menyimpan data dokumen.');
	}

	// Notifikasi in-app ke HRD supaya dokumen mandiri ini diverifikasi. Non-fatal.
	try {
		await directusServerJson('/items/app_notifications', {
			method: 'POST',
			body: JSON.stringify({
				type: 'dokumen',
				title: 'Dokumen mandiri diunggah',
				message: `${karyawan.nama_karyawan} mengunggah dokumen "${tipe.label}" secara mandiri, perlu diverifikasi.`,
				priority: 'medium',
				department: 'hrd',
				read: false,
				action_required: true,
				action_url: '/hrd?tab=dokumen',
				created_at: new Date().toISOString()
			})
		});
	} catch (e) {
		console.warn('[ess/dokumen] gagal membuat notifikasi (non-fatal):', (e as Error).message);
	}

	return json({ success: true, dokumen: created?.data });
};
