// src/routes/api/kiosk/qc/flag-rework/+server.ts
// Fase 4, rencana Kiosk QC Produksi (8-9 Sep 2026). Proxy tipis ke erp-epi-1
// action=flag_rework -- quick-flag, BUKAN createRework() penuh (§7 Fase 4). Endpoint
// terpisah dari /api/kiosk/qc (submit hasil) supaya masing-masing tetap satu tanggung jawab.
//
// Fase 6.1 (rencana lifecycle produksi v2, 15 Sep 2026): operator sekarang WAJIB pilih
// kategori defect + foto (bukan sekadar boolean+catatan bebas) — tetap SINYAL ke admin,
// BUKAN membuat rework langsung (keputusan Fase 4 dipertahankan). Foto diupload ke Directus
// project-epi sendiri (pola sama /api/kiosk/qc), erp-epi-1 hanya menerima ID file jadi.

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { requireKioskMenu } from '$lib/server/kioskMenuAccess';

export const POST: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	await requireKioskMenu(session.karyawanId, 'qc', 'Input Hasil QC');

	const form = await event.request.formData().catch(() => null);
	if (!form) throw error(400, 'Form data tidak valid.');

	const spkId = form.get('spkId');
	const note = form.get('note') ? String(form.get('note')).trim().slice(0, 500) : null;
	const defectCategory = form.get('defectCategory') ? String(form.get('defectCategory')) : null;
	const clientTxnId = form.get('clientTxnId');
	if (!spkId) throw error(400, 'spkId wajib diisi.');
	if (!clientTxnId) throw error(400, 'clientTxnId wajib diisi.');
	if (!defectCategory) throw error(400, 'Kategori defect wajib dipilih.');

	// Foto WAJIB (Fase 6.1) — sama semangatnya dengan foto bukti alat ukur di /api/kiosk/qc:
	// sinyal ke admin harus punya bukti visual, bukan cuma teks bebas.
	let defectPhotoId: string | null = null;
	const foto = form.get('foto');
	if (foto instanceof File && foto.size > 0) {
		const uploadForm = new FormData();
		uploadForm.append('file', foto, `flag-rework-${spkId}-${Date.now()}.jpg`);
		const uploadRes = await directusServerUpload(uploadForm);
		if (!uploadRes.ok) throw error(502, 'Gagal mengunggah foto defect.');
		const uploaded = await uploadRes.json();
		defectPhotoId = uploaded?.data?.id || null;
		if (!defectPhotoId) throw error(502, 'Gagal mengunggah foto defect.');
	} else {
		throw error(400, 'Foto defect wajib dilampirkan.');
	}

	const baseUrl = env.ERP_EPI1_BASE_URL;
	const secret = env.PRODUCTION_AUTOMATION_SECRET;
	if (!baseUrl || !secret) throw error(503, 'ERP_EPI1_BASE_URL/PRODUCTION_AUTOMATION_SECRET belum dikonfigurasi di server.');

	// Audit (audit-kiosk-master-lengkap.md Bagian 2 #5, Sedang): header ini meneruskan identitas
	// operator supaya rate limit di erp-epi-1 tidak dibagi rata IP server project-epi.
	const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/automation/qc-kiosk`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Automation-Secret': secret,
			'X-Kiosk-Actor': String(session.karyawanId)
		},
		body: JSON.stringify({
			action: 'flag_rework',
			spkId: Number(spkId),
			karyawanId: session.karyawanId,
			nama: session.nama,
			note,
			defectCategory,
			defectPhotoId,
			clientTxnId: String(clientTxnId)
		})
	});
	const data = await res.json().catch(() => null);
	if (!res.ok) throw error(res.status, data?.message || 'Gagal menandai SPK untuk rework.');

	return json(data);
};
