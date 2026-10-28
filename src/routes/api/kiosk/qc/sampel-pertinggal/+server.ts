// src/routes/api/kiosk/qc/sampel-pertinggal/+server.ts
// Fase 6C rencana lifecycle produksi: QC mencatat SAMPEL PERTINGGAL (retained sample) per batch —
// nomor botol + rak arsip. Disimpan di qc_retained_sample (BUKAN qc_results, supaya tidak muncul
// sebagai parameter di CoA/QA release). Dibaca gate G_PRD_QC_RETAINED_SAMPLE di erp-epi.
// Tidak mengubah stok maupun status SPK.

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { directusServerJson } from '$lib/server/directus';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { requireKioskMenu } from '$lib/server/kioskMenuAccess';

export const GET: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	await requireKioskMenu(session.karyawanId, 'qc', 'Input Hasil QC');
	const spkId = Number(event.url.searchParams.get('spkId'));
	if (!Number.isInteger(spkId) || spkId <= 0) throw error(400, 'spkId tidak valid.');
	const f = encodeURIComponent(JSON.stringify({ spk_id: { _eq: spkId }, status: { _eq: 'stored' } }));
	const res = await directusServerJson<{ data: any[] }>(
		`/items/qc_retained_sample?filter=${f}&fields=id,botol_no,rak_no,date_created&sort=-date_created&limit=20`
	).catch((e) => {
		console.error('[kiosk/qc/sampel-pertinggal] gagal baca daftar:', e?.message || e);
		throw error(502, 'Gagal memuat sampel pertinggal.');
	});
	return json({ data: res?.data || [] });
};

export const POST: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	await requireKioskMenu(session.karyawanId, 'qc', 'Input Hasil QC');
	const body = await event.request.json().catch(() => null);
	const spkId = Number(body?.spkId);
	const botolNo = body?.botolNo ? String(body.botolNo).trim().slice(0, 60) : '';
	const rakNo = body?.rakNo ? String(body.rakNo).trim().slice(0, 60) : '';
	const notes = body?.notes ? String(body.notes).trim().slice(0, 500) : '';
	const clientTxnId = body?.clientTxnId ? String(body.clientTxnId).trim().slice(0, 100) : '';

	if (!Number.isInteger(spkId) || spkId <= 0) throw error(400, 'Pilih SPK dulu.');
	if (!botolNo) throw error(400, 'Isi nomor botol sampel.');
	if (!rakNo) throw error(400, 'Isi nomor rak penyimpanan.');
	if (!clientTxnId) throw error(400, 'clientTxnId wajib diisi.');

	// Idempoten: retry / double-tap mengembalikan catatan yang sama.
	const ex = await directusServerJson<{ data: any[] }>(
		`/items/qc_retained_sample?filter[client_txn_id][_eq]=${encodeURIComponent(clientTxnId)}&fields=id&limit=1`
	).catch(() => ({ data: [] }));
	if (ex?.data?.[0]) return json({ success: true, data: ex.data[0], already_done: true });

	// SPK dibaca terpisah (tanpa relasi bersarang); produk & batch diambil server, bukan dari klien.
	const spkRes = await directusServerJson<{ data: any }>(`/items/spk/${spkId}?fields=id,batch_no,product_id`).catch((e) => {
		console.error(`[kiosk/qc/sampel-pertinggal] gagal baca SPK ${spkId}:`, e?.message || e);
		return null;
	});
	const spk = spkRes?.data;
	if (!spk) throw error(404, 'SPK tidak ditemukan.');
	const productId = typeof spk.product_id === 'object' ? spk.product_id?.id : spk.product_id;

	const created = await directusServerJson<{ data: any }>('/items/qc_retained_sample', {
		method: 'POST',
		body: JSON.stringify({
			status: 'stored',
			spk_id: spk.id,
			product_id: productId ?? null,
			batch_no: spk.batch_no ?? null,
			botol_no: botolNo,
			rak_no: rakNo,
			notes: notes || null,
			recorded_by: `kiosk:${session.karyawanId}:${session.nama}`,
			client_txn_id: clientTxnId
		})
	}).catch((e) => {
		console.error('[kiosk/qc/sampel-pertinggal] gagal simpan:', e?.message || e);
		throw error(502, 'Gagal menyimpan sampel pertinggal. Coba lagi.');
	});

	return json({ success: true, data: created?.data });
};
