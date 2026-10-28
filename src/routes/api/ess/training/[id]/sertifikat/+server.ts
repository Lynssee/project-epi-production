// Unduh PDF sertifikat training milik karyawan yang login — proxy server (token tak pernah ke klien),
// sama seperti /api/ess/my-hr-documents/[id]/download.
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerFetch, directusServerJson } from '$lib/server/directus';
import { findMyEnrollmentForProgram } from '$lib/server/ess/training';
import { isQrCertificateTitle } from '$lib/server/ess/trainingCertVerify';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const programId = Number(event.params.id);
	if (!Number.isFinite(programId)) throw error(400, 'ID kursus tidak valid.');

	const enrollment = await findMyEnrollmentForProgram(karyawan.id, programId);
	if (!enrollment) throw error(403, 'Anda belum terdaftar di kursus ini.');
	if (!enrollment.sertifikat_file) throw error(404, 'Sertifikat belum terbit untuk kursus ini.');

	// Sertifikat terbitan lama (sebelum fitur QR) tetap bisa diunduh; hanya ditandai "belum berQR" lewat header.
	// Query terpisah (bukan relasi bersarang) dan error-nya dicatat — bukan ditelan.
	let berQr = false;
	try {
		const meta = await directusServerJson<{ data: Array<{ title: string | null }> }>(
			`/files?${new URLSearchParams({ fields: 'title', limit: '1', 'filter[id][_eq]': enrollment.sertifikat_file }).toString()}`
		);
		berQr = isQrCertificateTitle(meta?.data?.[0]?.title);
	} catch (e) {
		console.error('[sertifikat] gagal membaca metadata file sertifikat:', e);
	}

	const fileRes = await directusServerFetch(`/assets/${enrollment.sertifikat_file}`, {});
	if (!fileRes.ok) throw error(502, 'Gagal mengambil berkas sertifikat dari server.');

	const buffer = await fileRes.arrayBuffer();
	return new Response(buffer, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `inline; filename="Sertifikat-${(enrollment.sertifikat_no || 'training').replace(/[^\w.\- ]/g, '_')}.pdf"`,
			'X-Sertifikat-Berqr': berQr ? '1' : '0',
			'Access-Control-Expose-Headers': 'X-Sertifikat-Berqr'
		}
	});
};
