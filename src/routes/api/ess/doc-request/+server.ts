// src/routes/api/ess/doc-request/+server.ts
// Karyawan mengajukan permintaan dokumen HR (SK Kerja untuk KPR, surat referensi, dsb.)
// dan melihat riwayat statusnya. Koleksi document_requests (erp-epi-1 Fase 4).

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

const REQUEST_FIELDS = [
	'id', 'jenis_dokumen', 'keperluan', 'prioritas', 'status',
	'generated_document', 'rejection_reason', 'date_created'
].join(',');

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawan.id),
		fields: REQUEST_FIELDS,
		sort: '-date_created',
		limit: '-1'
	});
	const result = await directusServerJson<{ data: any[] }>(`/items/document_requests?${query.toString()}`);
	return json({ requests: result?.data || [] });
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const body = await event.request.json().catch(() => null);
	const jenisDokumen = body?.jenis_dokumen;
	const keperluan = body?.keperluan;
	const prioritas = body?.prioritas === 'mendesak' ? 'mendesak' : 'biasa';
	if (!jenisDokumen) throw error(400, 'jenis_dokumen wajib diisi');
	if (!keperluan || !String(keperluan).trim()) throw error(400, 'keperluan wajib diisi');

	const created = await directusServerJson<{ data: any }>('/items/document_requests', {
		method: 'POST',
		body: JSON.stringify({
			karyawan_id: karyawan.id,
			jenis_dokumen: jenisDokumen,
			keperluan,
			prioritas,
			status: 'menunggu'
		})
	});

	// Notifikasi in-app langsung ke HRD (n8n WhatsApp/surel Fase 4 belum aktif — lihat memori
	// project-doc-generator-v4). Non-fatal: kegagalan notifikasi tidak menggagalkan permintaan.
	try {
		await directusServerJson('/items/app_notifications', {
			method: 'POST',
			body: JSON.stringify({
				type: 'dokumen',
				title: 'Permintaan dokumen baru',
				message: `${karyawan.nama_karyawan} mengajukan permintaan dokumen "${jenisDokumen}": ${keperluan}`,
				priority: prioritas === 'mendesak' ? 'high' : 'medium',
				department: 'hrd',
				read: false,
				action_required: true,
				action_url: '/dokumen?tab=permintaan',
				created_at: new Date().toISOString()
			})
		});
	} catch (e) {
		console.warn('[doc-request] gagal membuat notifikasi (non-fatal):', (e as Error).message);
	}

	return json({ success: true, data: created?.data });
};
