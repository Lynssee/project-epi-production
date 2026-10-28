import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listMySertifikasi, saveMySertifikasi } from '$lib/server/ess/sertifikasi';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const sertifikasi = await listMySertifikasi(karyawan.id);
	return json({ sertifikasi });
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const formData = await event.request.formData();
	const nama_sertifikasi = formData.get('nama_sertifikasi') as string;
	if (!nama_sertifikasi) throw error(400, 'nama_sertifikasi wajib diisi');

	const idRaw = formData.get('id');
	const file = formData.get('file') as File | null;

	try {
		const saved = await saveMySertifikasi(
			karyawan.id,
			{
				id: idRaw ? Number(idRaw) : undefined,
				nama_sertifikasi,
				penerbit: (formData.get('penerbit') as string) || undefined,
				tanggal_terbit: (formData.get('tanggal_terbit') as string) || undefined,
				tanggal_expired: (formData.get('tanggal_expired') as string) || undefined,
				catatan: (formData.get('catatan') as string) || undefined
			},
			file && file.size > 0 ? file : null
		);
		return json({ success: true, sertifikasi: saved });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal menyimpan sertifikasi');
	}
};
