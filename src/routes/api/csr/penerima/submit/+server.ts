import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';

/** NIK tidak pernah disimpan mentah — di-mask di server (6 digit awal + 4 digit akhir). */
function maskNik(raw: string): string {
	const digits = (raw || '').replace(/\D/g, '');
	if (digits.length < 10) return digits;
	return `${digits.slice(0, 6)}${'*'.repeat(digits.length - 10)}${digits.slice(-4)}`;
}

/**
 * Intake penerima manfaat CSR dari lapangan (consent UU PDP wajib) + serah terima
 * bantuan dengan tanda tangan digital penerima/perwakilan (opsional, disimpan sebagai file).
 */
export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const form = await event.request.formData().catch(() => null);
	if (!form) throw error(400, 'Form data tidak valid.');

	const programId = String(form.get('program_id') || '');
	const kegiatanId = form.get('kegiatan_id') ? String(form.get('kegiatan_id')) : null;
	const nama = String(form.get('nama') || '').trim();
	const kategori = String(form.get('kategori') || 'individu');
	const desaWilayah = String(form.get('desa_wilayah') || '').trim();
	const kontak = String(form.get('kontak') || '').trim();
	const nikRaw = String(form.get('nik') || '').trim();
	const consentPdp = String(form.get('consent_pdp') || '') === 'true';
	const signature = form.get('signature');

	if (!programId) throw error(400, 'Program CSR wajib dipilih.');
	if (!nama) throw error(400, 'Nama penerima wajib diisi.');
	if (!consentPdp) throw error(400, 'Persetujuan (consent) PDP wajib dicentang sebelum data disimpan.');

	let tandaTerimaId: string | null = null;
	if (signature instanceof File && signature.size > 0) {
		const uploadForm = new FormData();
		uploadForm.append('file', signature);
		const res = await directusServerUpload(uploadForm);
		if (!res.ok) throw error(502, 'Gagal mengunggah tanda tangan serah terima.');
		const uploaded = await res.json();
		tandaTerimaId = uploaded?.data?.id || null;
	}

	const now = new Date().toISOString();
	const response = await directusServerJson<{ data: any }>('/items/csr_penerima_manfaat', {
		method: 'POST',
		body: JSON.stringify({
			program_id: Number(programId),
			kegiatan_id: kegiatanId ? Number(kegiatanId) : null,
			nama,
			kategori,
			desa_wilayah: desaWilayah,
			nik_masked: nikRaw ? maskNik(nikRaw) : null,
			kontak,
			consent_pdp: true,
			tanda_terima: tandaTerimaId,
			access_level: 'rahasia',
			created_by: karyawan.nama_karyawan,
			created_at: now,
			updated_at: now
		})
	});

	return json({ record: response?.data ?? response, actor: karyawan.nama_karyawan });
};
