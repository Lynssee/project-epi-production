// src/routes/api/scan/batch/[id]/minta-retest/+server.ts
// Rencana Expired Date v2 Fase 5 — tombol "Minta Uji Ulang Lab QC" di layar scan kaleng.
// Membuat tiket Re-QC 'pending' untuk batch (antrean yang sama dengan panel Aging di erp-epi, jadi Lab melihatnya di sana).
// Idempoten: bila batch sudah punya tiket pending/menunggu_retest, tidak membuat tiket kedua.
// Batch HOLD/karantina tidak perlu tiket dari lapangan (keputusannya di tim QC) — ditolak dengan pesan jelas.
import { error, json, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';

export async function POST(event: RequestEvent) {
	const authUser: any = await requireUser(event);
	const id = Number(event.params.id);
	if (!Number.isFinite(id) || id <= 0) throw error(400, 'ID batch tidak valid.');

	const batch = (await directusServerJson<{ data: any }>(`/items/item_batch/${id}?fields=id,item_id,lot_number,batch_no_fg,status,tanggal_kadaluarsa`).catch(() => null))?.data;
	if (!batch) throw error(404, `Batch #${id} tidak ditemukan.`);
	if (batch.status === 'quarantine') throw error(409, 'Batch sedang dikarantina — keputusan ada di tim QC, tidak perlu minta uji ulang dari lapangan.');
	const batchNo: string | null = batch.batch_no_fg || batch.lot_number || null;
	if (!batchNo) throw error(409, 'Batch ini belum punya nomor batch/lot, tidak bisa dibuatkan tiket. Hubungi gudang.');

	const pending = (await directusServerJson<{ data: any[] }>(
		`/items/qc_retest_tickets?filter[batch_no][_eq]=${encodeURIComponent(batchNo)}&filter[hasil][_in]=pending,menunggu_retest&fields=id&limit=1`
	).catch(() => null))?.data;
	if (pending?.length) return json({ dibuat: false, sudahAda: true, pesan: 'Permintaan uji ulang untuk batch ini sudah ada dan menunggu Lab QC.' });

	const item = batch.item_id != null
		? (await directusServerJson<{ data: any }>(`/items/identitas_barang/${batch.item_id}?fields=id,nama_barang_lengkap`).catch(() => null))?.data
		: null;

	try {
		await directusServerJson('/items/qc_retest_tickets', {
			method: 'POST',
			body: JSON.stringify({
				batch_no: batchNo,
				nama_barang: item?.nama_barang_lengkap || null,
				hasil: 'pending',
				catatan: `Diminta dari lapangan (scan QR kaleng) — batch ${batch.tanggal_kadaluarsa ? `kadaluarsa ${String(batch.tanggal_kadaluarsa).slice(0, 10)}` : 'tanpa tanggal kadaluarsa'}. Mohon uji ulang cepat.`,
				diuji_oleh: authUser?.email || authUser?.localId || 'lapangan',
				diuji_pada: new Date().toISOString()
			})
		});
	} catch (e: any) {
		console.error('[minta-retest] gagal membuat tiket:', e?.message || e);
		throw error(502, `Gagal membuat permintaan uji ulang: ${e?.message || 'kesalahan Directus'}`);
	}
	return json({ dibuat: true, sudahAda: false, pesan: 'Permintaan uji ulang terkirim ke Lab QC.' });
}
