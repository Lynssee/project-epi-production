// src/routes/api/kiosk/siapkan-sj/+server.ts
// SJH-07 §4.3 — Kiosk Gudang "Siapkan SJ": staf gudang menandai barang SUDAH terkumpul di area muat =
// TTD #1 "Disiapkan oleh" (surat_jalan.pracetak_gudang) yang dibaca gate G_SJ_SIAP_GUDANG / G_SJ_TTD_PRACETAK.
// SJ belum tercetak (QR belum ada), jadi dicari dengan NOMOR. Guard: sesi kiosk + menu `siapkan_sj`.
// Aktor selalu dari sesi kiosk. Aturan sama dengan endpoint admin (sjPracetakRule).
//
//   GET  ?nomor=SJ/...  -> { sj, items, state:'siap'|'sudah'|'ditolak', alasan? }
//   POST { sjId, catatan? } -> rekam TTD gudang (idempoten: tidak menimpa TTD yang ada)

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { requireKioskMenu } from '$lib/server/kioskMenuAccess';
import { directusServerJson } from '$lib/server/directus';
import { decidePracetakAction } from '$lib/server/sjPracetakRule';

const SJ_FIELDS = 'id,nomor_sj,status,print_count,reprint_status,pracetak_gudang,delivery_address';

async function loadItems(sjId: number) {
	return (await directusServerJson<{ data: any[] }>(
		`/items/surat_jalan_items?filter[surat_jalan_id][_eq]=${sjId}&fields=id,nama_barang,qty_delivered,qty_required,unit&sort=id&limit=-1`
	).catch(() => ({ data: [] as any[] })))?.data || [];
}

export const GET: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	await requireKioskMenu(session.karyawanId, 'siapkan_sj', 'Siapkan SJ');
	const nomor = (event.url.searchParams.get('nomor') || '').trim();
	if (nomor.length < 3) throw error(400, 'Ketik nomor Surat Jalan (min. 3 karakter).');

	const r = await directusServerJson<{ data: any[] }>(
		`/items/surat_jalan?filter[nomor_sj][_eq]=${encodeURIComponent(nomor)}&fields=${SJ_FIELDS}&limit=1`
	).catch(() => ({ data: [] as any[] }));
	const sj = r?.data?.[0];
	if (!sj) throw error(404, `Nomor "${nomor}" tidak ditemukan. Cek penulisan nomor SJ.`);

	const decision = decidePracetakAction(sj);
	const items = await loadItems(sj.id);
	return json({
		sj: { id: sj.id, nomor_sj: sj.nomor_sj, status: sj.status, tujuan: sj.delivery_address || null },
		items,
		state: decision.action === 'write' ? 'siap' : decision.action === 'already' ? 'sudah' : 'ditolak',
		alasan: decision.action === 'reject' ? decision.message : null,
		existing: decision.action === 'already' ? { by_name: decision.existing.by_name, at: decision.existing.at } : null
	});
};

export const POST: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	await requireKioskMenu(session.karyawanId, 'siapkan_sj', 'Siapkan SJ');
	const body = await event.request.json().catch(() => null);
	const sjId = Number(body?.sjId);
	if (!Number.isFinite(sjId) || sjId <= 0) throw error(400, 'sjId tidak valid.');
	const catatan = body?.catatan ? String(body.catatan).slice(0, 300) : '';

	const sj = (await directusServerJson<{ data: any }>(`/items/surat_jalan/${sjId}?fields=${SJ_FIELDS}`).catch(() => null))?.data;
	if (!sj) throw error(404, 'Surat Jalan tidak ditemukan.');

	const decision = decidePracetakAction(sj);
	if (decision.action === 'reject') throw error(decision.status, decision.message);
	if (decision.action === 'already') return json({ success: true, already_filled: true, pracetak_gudang: decision.existing });

	const pracetak_gudang = {
		by: session.karyawanId,
		by_name: session.nama,
		at: new Date().toISOString(),
		signature_file: null,
		checklist: ['Barang sudah terkumpul di area muat', ...(catatan ? [catatan] : [])],
		source: 'kiosk'
	};
	await directusServerJson(`/items/surat_jalan/${sjId}`, { method: 'PATCH', body: JSON.stringify({ pracetak_gudang }) })
		.catch((e) => {
			console.error('[kiosk/siapkan-sj] gagal simpan pracetak_gudang:', e instanceof Error ? e.message : e);
			throw error(502, 'Gagal menyimpan TTD gudang. Coba lagi.');
		});
	return json({ success: true, pracetak_gudang });
};
