// src/routes/api/notifikasi/[id]/download/+server.ts
// Unduh PDF summary yang terlampir di notifikasi in-app milik karyawan yang login. Ownership
// check dulu (attachment_file_id notifikasi ini memang milik pemanggil) sebelum stream dari
// Directus assets — pola sama ess/my-hr-documents/[id]/download/+server.ts, tanpa dekripsi
// (PDF summary tidak dienkripsi, beda dari dokumen payroll).

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerFetch } from '$lib/server/directus';
import { getNotificationAttachment } from '$lib/server/ess/notifikasi';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	let fileId: string;
	try {
		fileId = await getNotificationAttachment(event.params.id!, karyawan.id);
	} catch (e) {
		throw error(403, (e as Error).message);
	}

	const fileRes = await directusServerFetch(`/assets/${fileId}`, {});
	if (!fileRes.ok) throw error(502, 'Gagal mengambil berkas dari server.');

	const buffer = await fileRes.arrayBuffer();
	return new Response(buffer, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `attachment; filename="notifikasi-${event.params.id}.pdf"`
		}
	});
};
