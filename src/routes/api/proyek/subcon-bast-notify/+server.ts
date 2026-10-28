// src/routes/api/proyek/subcon-bast-notify/+server.ts
// ⚠️ SERVER-ONLY. Webhook n8n saat BAST pengembalian aset/material Subcon atau Customer diterbitkan di site (Fase 3).
import { json } from '@sveltejs/kit';
import type { RequestEvent } from './$types.js';
import { notifyN8n } from '$lib/server/n8nNotify.js';

export async function POST({ request }: RequestEvent) {
	try {
		const body = await request.json().catch(() => ({}));
		const { projectId, projectName, pihakKedua, uraianBarang, nomorDokumen, createdBy } = body;

		if (!projectId) {
			return json({ success: false, error: 'projectId wajib diisi' }, { status: 400 });
		}

		const result = await notifyN8n('subcon_bast_generated', {
			project_id: projectId,
			project_name: projectName || '',
			pihak_kedua: pihakKedua || 'Subcon',
			uraian_barang: uraianBarang || '',
			nomor_dokumen: nomorDokumen || '',
			created_by: createdBy || 'Site Leader',
			message: `BAST Pengembalian Aset/Material untuk ${pihakKedua || 'Subcon'} pada proyek ${projectName || projectId} telah diterbitkan di site (No. ${nomorDokumen || '-'}).`
		});

		return json({ success: true, notified: result.sent, reason: result.reason });
	} catch (err: any) {
		console.warn('[subcon-bast-notify] Gagal proses notifikasi (fail-soft):', err?.message || err);
		return json({ success: false, error: err?.message || 'Internal error' }, { status: 500 });
	}
}
