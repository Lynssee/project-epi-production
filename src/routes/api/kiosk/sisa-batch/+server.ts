// src/routes/api/kiosk/sisa-batch/+server.ts
// Fase 4 rencana lifecycle produksi: operator kiosk mencatat SISA BATCH (cat tersisa di tangki/drum)
// setelah produksi. Disimpan ke production_remainder (status 'stored') dan dibaca gate
// G_PRD_REWORK_STOCK_CHECK di dashboard admin sebagai kandidat pemakaian ulang.
// Tidak menyentuh stok/ledger — murni catatan sisa (nol efek ke inventory).

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { directusServerJson } from '$lib/server/directus';
import { requireKioskSession } from '$lib/server/kioskAuth';

const MAX_KG = 100000;

/** Sisa batch tersimpan untuk satu SPK (ditampilkan di kartu agar operator tahu yang sudah dicatat). */
export const GET: RequestHandler = async (event) => {
	requireKioskSession(event);
	const spkId = Number(event.url.searchParams.get('spkId'));
	if (!Number.isInteger(spkId) || spkId <= 0) throw error(400, 'spkId tidak valid.');
	const f = encodeURIComponent(JSON.stringify({ spk_id: { _eq: spkId }, status: { _eq: 'stored' } }));
	const res = await directusServerJson<{ data: any[] }>(
		`/items/production_remainder?filter=${f}&fields=id,remainder_kg,location,date_created&sort=-date_created&limit=20`
	).catch((e) => {
		console.error('[kiosk/sisa-batch] gagal baca sisa batch:', e?.message || e);
		throw error(502, 'Gagal memuat sisa batch.');
	});
	return json({ data: res?.data || [] });
};

export const POST: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	const body = await event.request.json().catch(() => null);
	const spkId = Number(body?.spkId);
	const kg = Number(body?.remainderKg);
	const location = body?.location ? String(body.location).trim().slice(0, 100) : '';
	const notes = body?.notes ? String(body.notes).trim().slice(0, 500) : '';
	const clientTxnId = body?.clientTxnId ? String(body.clientTxnId).trim().slice(0, 100) : '';

	if (!Number.isInteger(spkId) || spkId <= 0) throw error(400, 'Pilih SPK dulu.');
	if (!Number.isFinite(kg) || kg <= 0 || kg > MAX_KG) throw error(400, 'Isi berat sisa (kg) dengan angka lebih dari 0.');
	if (!clientTxnId) throw error(400, 'clientTxnId wajib diisi.');

	// Idempoten: retry / double-tap mengembalikan catatan yang sama.
	const ex = await directusServerJson<{ data: any[] }>(
		`/items/production_remainder?filter[client_txn_id][_eq]=${encodeURIComponent(clientTxnId)}&fields=id&limit=1`
	).catch(() => ({ data: [] }));
	if (ex?.data?.[0]) return json({ success: true, data: ex.data[0], already_done: true });

	// SPK dibaca terpisah (tanpa relasi bersarang) — produk diambil dari server, bukan dari klien.
	const spkRes = await directusServerJson<{ data: any }>(`/items/spk/${spkId}?fields=id,nomor,product_id`).catch((e) => {
		console.error(`[kiosk/sisa-batch] gagal baca SPK ${spkId}:`, e?.message || e);
		return null;
	});
	const spk = spkRes?.data;
	if (!spk) throw error(404, 'SPK tidak ditemukan.');
	const productId = typeof spk.product_id === 'object' ? spk.product_id?.id : spk.product_id;

	const created = await directusServerJson<{ data: any }>('/items/production_remainder', {
		method: 'POST',
		body: JSON.stringify({
			status: 'stored',
			spk_id: spk.id,
			product_id: productId ?? null,
			remainder_kg: kg,
			location: location || null,
			notes: notes || null,
			source: 'kiosk',
			recorded_by: `kiosk:${session.karyawanId}:${session.nama}`,
			client_txn_id: clientTxnId
		})
	}).catch((e) => {
		console.error('[kiosk/sisa-batch] gagal simpan sisa batch:', e?.message || e);
		throw error(502, 'Gagal menyimpan sisa batch. Coba lagi.');
	});

	return json({ success: true, data: created?.data });
};
