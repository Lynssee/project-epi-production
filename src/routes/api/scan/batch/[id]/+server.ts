// src/routes/api/scan/batch/[id]/+server.ts
// Fase 4 QC Re-test Cat Keluar — resolver scan QR label kaleng (EPI:BATCH:<id item_batch>, dicetak ERP
// labelHtml.js). Mengembalikan info batch untuk layar lapangan: produk, tgl produksi/kadaluarsa, umur,
// CoA, status Re-QC, HOLD (komplain terbuka), dan panduan teknis dari spesifikasi produk.
// Fetching relasi DIPISAH per query (Aturan #2); data pelengkap yang gagal dibaca tidak menggagalkan scan
// (dicatat di log, field jadi null) — hanya item_batch yang wajib ada.

import { error, json, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';

async function opt<T>(label: string, p: Promise<T>): Promise<T | null> {
	try {
		return await p;
	} catch (e: any) {
		console.error(`[scan/batch] gagal baca ${label}:`, e?.message || e);
		return null;
	}
}

export async function GET(event: RequestEvent) {
	await requireUser(event);
	const id = Number(event.params.id);
	if (!Number.isFinite(id) || id <= 0) throw error(400, 'ID batch tidak valid.');

	const batch = (await directusServerJson<{ data: any }>(
		`/items/item_batch/${id}?fields=id,item_id,lot_number,batch_no_fg,tanggal_produksi,tanggal_kadaluarsa,qty_tersisa,satuan,status`
	).catch(() => null))?.data;
	if (!batch) throw error(404, `Batch #${id} tidak ditemukan di sistem.`);

	const batchNo: string | null = batch.batch_no_fg || batch.lot_number || null;

	const [item, spk, complaints] = await Promise.all([
		batch.item_id != null
			? opt('identitas_barang', directusServerJson<{ data: any }>(`/items/identitas_barang/${batch.item_id}?fields=id,nama_barang_lengkap,kode_fg_id`).then((r) => r?.data))
			: Promise.resolve(null),
		batchNo
			? opt('spk', directusServerJson<{ data: any[] }>(`/items/spk?filter[batch_no][_eq]=${encodeURIComponent(batchNo)}&fields=id,nomor&limit=1`).then((r) => r?.data?.[0] || null))
			: Promise.resolve(null),
		batchNo
			? opt('customer_complaints', directusServerJson<{ data: any[] }>(
					`/items/customer_complaints?filter[batch_number][_eq]=${encodeURIComponent(batchNo)}&filter[status][_neq]=tutup&fields=id&limit=1`
				).then((r) => r?.data || []))
			: Promise.resolve([])
	]);

	const [coa, retest, spec] = await Promise.all([
		spk?.id != null
			? opt('coa_documents', directusServerJson<{ data: any[] }>(
					`/items/coa_documents?filter[spk_id][_eq]=${spk.id}&filter[status][_eq]=issued&sort=-issued_at&fields=id,kode,issued_at&limit=1`
				).then((r) => r?.data?.[0] || null))
			: Promise.resolve(null),
		batchNo
			? opt('qc_retest_tickets', directusServerJson<{ data: any[] }>(
					`/items/qc_retest_tickets?filter[batch_no][_eq]=${encodeURIComponent(batchNo)}&filter[hasil][_eq]=lulus&sort=-diuji_pada&fields=id,diuji_pada,berlaku_sampai&limit=1`
				).then((r) => r?.data?.[0] || null))
			: Promise.resolve(null),
		item?.kode_fg_id != null
			? opt('foxapaint_product_specs', directusServerJson<{ data: any[] }>(
					`/items/foxapaint_product_specs?filter[kode_fg_id][_eq]=${encodeURIComponent(item.kode_fg_id)}` +
						`&fields=thinner_type,thinning_ratio,surface_preparation,application_method,overcoating_min_hours,overcoating_max_hours,storage_conditions,shelf_life_months&limit=1`
				).then((r) => r?.data?.[0] || null))
			: Promise.resolve(null)
	]);

	const prod = batch.tanggal_produksi ? new Date(batch.tanggal_produksi).getTime() : NaN;
	const umurHari = Number.isFinite(prod) ? Math.max(0, Math.floor((Date.now() - prod) / 86400000)) : null;
	const expMs = batch.tanggal_kadaluarsa ? new Date(batch.tanggal_kadaluarsa).getTime() : NaN;
	const retestAktif = !!retest && (!retest.berlaku_sampai || new Date(`${String(retest.berlaku_sampai).slice(0, 10)}T23:59:59`).getTime() >= Date.now());

	return json({
		batch: {
			id: batch.id,
			batchNo,
			namaBarang: item?.nama_barang_lengkap || null,
			tanggalProduksi: batch.tanggal_produksi || null,
			tanggalKadaluarsa: batch.tanggal_kadaluarsa || null,
			kadaluarsaLewat: Number.isFinite(expMs) ? expMs < Date.now() : false,
			umurHari,
			status: batch.status || null
		},
		coa: coa ? { kode: coa.kode, issuedAt: coa.issued_at } : null,
		retest: { aktif: retestAktif, berlakuSampai: retest?.berlaku_sampai || null },
		hold: (complaints?.length ?? 0) > 0,
		panduan: spec
			? {
					thinnerType: spec.thinner_type || null,
					thinningRatio: spec.thinning_ratio || null,
					persiapanPermukaan: spec.surface_preparation || null,
					metodeAplikasi: spec.application_method || null,
					overcoatMinJam: spec.overcoating_min_hours ?? null,
					overcoatMaxJam: spec.overcoating_max_hours ?? null,
					penyimpanan: spec.storage_conditions || null
				}
			: null
	});
}
