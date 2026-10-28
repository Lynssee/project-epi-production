import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerFetch, directusServerJson } from '$lib/server/directus';
import { getServerDEK } from '$lib/server/ess/payrollUnlock';
import { decryptFileBytes } from '$lib/server/ess/payrollCrypto';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const id = event.params.id;

	const query = new URLSearchParams({ fields: 'id,karyawan_id,file_id,is_encrypted,nama_dokumen' });
	const doc = await directusServerJson<{ data: any }>(`/items/karyawan_dokumen/${id}?${query.toString()}`);
	if (!doc?.data) throw error(404, 'Dokumen tidak ditemukan.');
	if (String(doc.data.karyawan_id) !== String(karyawan.id)) {
		throw error(403, 'Anda tidak memiliki akses ke dokumen ini.');
	}

	const fileId = Array.isArray(doc.data.file_id) ? doc.data.file_id[0] : doc.data.file_id;
	if (!fileId) throw error(404, 'Berkas dokumen tidak ditemukan.');

	const fileRes = await directusServerFetch(`/assets/${fileId}`, {});
	if (!fileRes.ok) throw error(502, 'Gagal mengambil berkas dari server.');

	const contentType = fileRes.headers.get('content-type') || 'application/octet-stream';
	let buffer = await fileRes.arrayBuffer();

	if (doc.data.is_encrypted) {
		const dek = await getServerDEK();
		buffer = await decryptFileBytes(buffer, dek);
	}

	return new Response(buffer, {
		headers: {
			'Content-Type': contentType,
			'Content-Disposition': `inline; filename="${(doc.data.nama_dokumen || 'dokumen').replace(/[^\w.\- ]/g, '_')}"`
		}
	});
};
