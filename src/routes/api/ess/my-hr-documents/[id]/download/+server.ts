// src/routes/api/ess/my-hr-documents/[id]/download/+server.ts
// Unduh PDF dokumen HR milik karyawan yang login — dekripsi di server (T-payroll),
// karyawan tidak pernah memegang DEK. Sama seperti /api/ess/dokumen/[id]/file, kecuali
// sumbernya hr_generated_document (bukan karyawan_dokumen).

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerFetch, directusServerJson } from '$lib/server/directus';
import { getServerDEK } from '$lib/server/ess/payrollUnlock';
import { decryptFileBytes, isEncryptedFile } from '$lib/server/ess/payrollCrypto';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const id = event.params.id;

	const query = new URLSearchParams({ fields: 'id,karyawan_id,file_id,nomor_dokumen' });
	const doc = await directusServerJson<{ data: any }>(`/items/hr_generated_document/${id}?${query.toString()}`);
	if (!doc?.data) throw error(404, 'Dokumen tidak ditemukan.');
	if (String(doc.data.karyawan_id) !== String(karyawan.id)) {
		throw error(403, 'Anda tidak memiliki akses ke dokumen ini.');
	}
	if (!doc.data.file_id) throw error(404, 'Berkas dokumen tidak ditemukan.');

	const fileRes = await directusServerFetch(`/assets/${doc.data.file_id}`, {});
	if (!fileRes.ok) throw error(502, 'Gagal mengambil berkas dari server.');

	let buffer = await fileRes.arrayBuffer();
	if (isEncryptedFile(buffer)) {
		const dek = await getServerDEK();
		buffer = await decryptFileBytes(buffer, dek);
	}

	return new Response(buffer, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `inline; filename="${(doc.data.nomor_dokumen || 'dokumen').replace(/[^\w.\- ]/g, '_')}.pdf"`
		}
	});
};
