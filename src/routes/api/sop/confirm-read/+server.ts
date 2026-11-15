// src/routes/api/sop/confirm-read/+server.ts
// SERVER-ONLY. Mencatat konfirmasi baca SOP dari lapangan (project-epi) oleh teknisi/pekerja.

import { json, type RequestHandler } from '@sveltejs/kit';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	if (!karyawan?.id) {
		return json({ success: false, error: 'Data profil karyawan tidak ditemukan' }, { status: 400 });
	}

	const body = await event.request.json().catch(() => ({}));
	const sopId = body.sop_id ? Number(body.sop_id) : null;
	const flowKey = body.flow_key ? String(body.flow_key).trim() : null;
	const flowVersion = body.flow_version ? Number(body.flow_version) : null;

	if (!sopId && !flowKey) {
		return json({ success: false, error: 'ID SOP atau Kunci Alur wajib dicantumkan' }, { status: 400 });
	}

	try {
		let sopVersionSeq = 1;
		if (sopId) {
			const sopRes = await directusServerJson<{ data: any }>(`/items/sop_documents/${sopId}?fields=id,version_seq`).catch(() => null);
			if (!sopRes?.data?.id) {
				return json({ success: false, error: 'Dokumen SOP tidak ditemukan' }, { status: 404 });
			}
			sopVersionSeq = Number(sopRes.data.version_seq) || 1;
		}

		let filterStr = `filter[karyawan_id][_eq]=${karyawan.id}&`;
		if (sopId) filterStr += `filter[sop_id][_eq]=${sopId}&`;
		if (flowKey) filterStr += `filter[flow_key][_eq]=${encodeURIComponent(flowKey)}&`;

		const existingRes = await directusServerJson<{ data: any[] }>(`/items/sop_read_confirmations?${filterStr}limit=1&fields=id,sop_version_seq,flow_version`);
		const existing = existingRes?.data?.[0];
		const clientIp = event.getClientAddress ? event.getClientAddress() : null;

		if (existing) {
			const hasSopMatch = sopId && Number(existing.sop_version_seq || 0) >= sopVersionSeq;
			const hasFlowMatch = flowKey && Number(existing.flow_version || 0) >= (flowVersion || 1);
			if (hasSopMatch || hasFlowMatch) {
				return json({ success: true, message: 'Sudah dikonfirmasi sebelumnya', already_confirmed: true });
			}
			await directusServerJson(`/items/sop_read_confirmations/${existing.id}`, {
				method: 'PATCH',
				body: JSON.stringify({
					sop_version_seq: sopVersionSeq,
					flow_version: flowVersion || existing.flow_version,
					confirmed_at: new Date().toISOString(),
					ip_address: clientIp
				})
			});
			return json({ success: true, message: 'Pembaruan konfirmasi baca berhasil dicatat' });
		}

		await directusServerJson('/items/sop_read_confirmations', {
			method: 'POST',
			body: JSON.stringify({
				karyawan_id: karyawan.id,
				sop_id: sopId || null,
				sop_version_seq: sopVersionSeq,
				flow_key: flowKey || null,
				flow_version: flowVersion || null,
				confirmed_at: new Date().toISOString(),
				ip_address: clientIp
			})
		});

		return json({ success: true, message: 'Konfirmasi baca berhasil dicatat' });
	} catch (err: any) {
		console.error('[/api/sop/confirm-read project-epi] Gagal mencatat konfirmasi:', err?.message || err);
		return json({ success: false, error: err?.message || 'Gagal mencatat konfirmasi baca' }, { status: 500 });
	}
};
