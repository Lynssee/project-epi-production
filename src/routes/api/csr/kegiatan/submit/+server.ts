import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';

/**
 * Submit kegiatan CSR dari lapangan: foto + GPS + jumlah penerima + catatan.
 * Status awal 'draft' — menunggu verifikasi/lengkapi biaya di Admin (erp-epi-1) sebelum
 * dipakai untuk realisasi anggaran. Foto diunggah di server (bukan dipercaya dari klien).
 */
export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const form = await event.request.formData().catch(() => null);
	if (!form) throw error(400, 'Form data tidak valid.');

	const programId = String(form.get('program_id') || '');
	const jenis = String(form.get('jenis') || '').trim();
	const catatanLapangan = String(form.get('catatan_lapangan') || '').trim();
	const jumlahPenerima = Number(form.get('jumlah_penerima') || 0);
	const lat = form.get('lat') ? Number(form.get('lat')) : null;
	const lng = form.get('lng') ? Number(form.get('lng')) : null;

	if (!programId) throw error(400, 'Program CSR wajib dipilih.');
	if (!jenis) throw error(400, 'Jenis kegiatan wajib diisi.');

	// Validasi program memang ada & sedang berjalan.
	const programRes = await directusServerJson<{ data: any[] }>(
		`/items/csr_program?${new URLSearchParams({ 'filter[id][_eq]': programId, limit: '1' }).toString()}`
	);
	const program = programRes?.data?.[0];
	if (!program) throw error(404, 'Program CSR tidak ditemukan.');

	// Upload foto (bisa lebih dari satu, key: photo_0, photo_1, ...)
	const fotoIds: string[] = [];
	for (const [key, value] of form.entries()) {
		if (!key.startsWith('photo_') || !(value instanceof File) || value.size === 0) continue;
		const uploadForm = new FormData();
		uploadForm.append('file', value);
		const res = await directusServerUpload(uploadForm);
		if (!res.ok) throw error(502, 'Gagal mengunggah foto kegiatan.');
		const uploaded = await res.json();
		if (uploaded?.data?.id) fotoIds.push(uploaded.data.id);
	}
	if (fotoIds.length === 0) throw error(400, 'Minimal satu foto bukti kegiatan wajib diunggah.');

	const now = new Date().toISOString();
	const response = await directusServerJson<{ data: any }>('/items/csr_kegiatan', {
		method: 'POST',
		body: JSON.stringify({
			program_id: Number(programId),
			tanggal: now.slice(0, 10),
			jenis,
			lokasi_lat: lat,
			lokasi_lng: lng,
			jumlah_penerima: jumlahPenerima,
			foto: fotoIds,
			status: 'draft',
			catatan_lapangan: catatanLapangan,
			created_by: karyawan.nama_karyawan,
			created_at: now,
			updated_at: now
		})
	});

	// Notifikasi ke Admin CSR — non-fatal.
	await directusServerJson('/items/app_notifications', {
		method: 'POST',
		body: JSON.stringify({
			type: 'CSR_KEGIATAN_SUBMITTED',
			title: `Kegiatan CSR Baru — ${program.nama}`,
			message: `${karyawan.nama_karyawan} mencatat kegiatan "${jenis}" (${jumlahPenerima} penerima). Menunggu verifikasi.`,
			priority: 'medium',
			department: 'csr',
			read: false,
			action_required: true,
			action_url: '/csr?tab=kegiatan',
			created_at: now
		})
	}).catch(() => {});

	return json({ record: response?.data ?? response, actor: karyawan.nama_karyawan });
};
