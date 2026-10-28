import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { submitResign } from '$lib/server/ess/offboarding';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json().catch(() => ({}));
	const { alasan, tanggalEfektif } = body;
	if (!alasan || String(alasan).trim().length < 10) throw error(400, 'Alasan resign wajib diisi (minimal 10 karakter)');
	if (!tanggalEfektif) throw error(400, 'Tanggal efektif wajib diisi');

	try {
		const result = await submitResign(karyawan.id, String(alasan).trim(), tanggalEfektif);
		return json({ success: true, ...result });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal mengajukan resign');
	}
};
