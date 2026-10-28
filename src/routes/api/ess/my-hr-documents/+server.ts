// src/routes/api/ess/my-hr-documents/+server.ts
// Daftar dokumen HR milik karyawan yang login (hr_generated_document, dari erp-epi-1) +
// status tanda tangan (doc_signature) untuk badge "Menunggu tanda tangan Anda" di /ess/dokumen-saya.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

const DOC_FIELDS = [
	'id', 'nomor_dokumen', 'jenis', 'judul', 'status', 'status_ttd',
	'tanggal_terbit', 'tanggal_expired', 'file_id'
].join(',');

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const docQuery = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawan.id),
		'filter[status][_neq]': 'dibatalkan',
		fields: DOC_FIELDS,
		sort: '-tanggal_terbit',
		limit: '-1'
	});
	const docRes = await directusServerJson<{ data: any[] }>(`/items/hr_generated_document?${docQuery.toString()}`);
	const documents = docRes?.data || [];

	const sigQuery = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawan.id),
		fields: 'id,dokumen_id,status,peran',
		limit: '-1'
	});
	const sigRes = await directusServerJson<{ data: any[] }>(`/items/doc_signature?${sigQuery.toString()}`);
	const pendingDocIds = new Set(
		(sigRes?.data || []).filter((s) => s.status === 'pending').map((s) => s.dokumen_id)
	);

	const enriched = documents.map((d) => ({ ...d, needsSignature: pendingDocIds.has(d.id) }));

	return json({ documents: enriched, pendingCount: pendingDocIds.size });
};
