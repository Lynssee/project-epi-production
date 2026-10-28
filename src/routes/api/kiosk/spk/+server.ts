// src/routes/api/kiosk/spk/+server.ts
// Fase 6 (correction_plan_antrean-packing-list-gudang-terpotong, Bagian B, B1): endpoint
// pencarian SPK aktif untuk kiosk/input-produksi. Sebelumnya /api/kiosk/home mengembalikan
// maksimal 20 SPK dan halaman mencari HANYA di 20 itu (client-side), sehingga operator tidak
// bisa menemukan SPK ke-21 dst walau statusnya aktif. Endpoint ini dipanggil terpisah saat
// operator mengetik kata kunci atau menekan "Muat lebih banyak" -- /api/kiosk/home tetap
// dipakai untuk pemuatan cepat 20 pertama saat halaman dibuka.

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { directusServerJson } from '$lib/server/directus';
import { requireKioskSession } from '$lib/server/kioskAuth';

const SPK_FIELDS = 'id,nomor,batch_no,status,product_id.nama_barang_lengkap,quantity,unit,tanggal';
const PAGE_SIZE_MAX = 50;

// §3.1 (file 03) — kelompok SPK untuk kiosk: SPK belum dimulai (bahan belum dipotong) TIDAK
// bisa diisi (lihat validasi status di api/kiosk/produksi), tapi tetap perlu tampil di kiosk
// (opsi b, direkomendasikan) supaya operator tahu SPK-nya ada dan bisa minta dimulai.
const KELOMPOK_STATUS: Record<string, string> = {
	berjalan: 'in_progress',
	belum_mulai: 'worksheet_generated,waiting_for_stock'
};

export const GET: RequestHandler = async (event) => {
	requireKioskSession(event);

	const url = event.url;
	const q = (url.searchParams.get('q') || '').trim();
	const limit = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10) || 20));
	const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

	// Lookup langsung by id — dipakai scan QR SPK di luar halaman pertama (H11, file 03 §3.6).
	const idParam = Number(url.searchParams.get('id'));
	if (Number.isInteger(idParam) && idParam > 0) {
		const r = await directusServerJson<{ data: any }>(`/items/spk/${idParam}?fields=${SPK_FIELDS}`).catch((e) => {
			console.error('[api/kiosk/spk] lookup id gagal', idParam, e?.message || e);
			return null;
		});
		return json({ data: r?.data ? [r.data] : [], total: r?.data ? 1 : 0 });
	}

	const kelompok = url.searchParams.get('kelompok') === 'belum_mulai' ? 'belum_mulai' : 'berjalan';
	const filterParts = [`filter[_and][0][status][_in]=${KELOMPOK_STATUS[kelompok]}`];

	if (q.length >= 2) {
		// Nama produk berasal dari relasi identitas_barang -- dicari lewat query terpisah
		// (Aturan #2, jangan filter relasi bersarang), lalu id-nya digabung ke _or lewat product_id.
		let productIds: (string | number)[] = [];
		try {
			const productRes = await directusServerJson<{ data: any[] }>(
				`/items/identitas_barang?filter[nama_barang_lengkap][_icontains]=${encodeURIComponent(q)}&fields=id&limit=50`
			);
			productIds = (productRes?.data || []).map((p) => p.id).filter(Boolean);
		} catch {
			// Pencarian nama produk gagal (mis. Directus lambat) -- tetap lanjut dengan nomor/batch_no
			// saja, jangan gagalkan seluruh pencarian karena satu sub-query relasi.
			productIds = [];
		}

		const orParts = [
			`filter[_and][1][_or][0][nomor][_icontains]=${encodeURIComponent(q)}`,
			`filter[_and][1][_or][1][batch_no][_icontains]=${encodeURIComponent(q)}`
		];
		if (productIds.length > 0) {
			orParts.push(`filter[_and][1][_or][2][product_id][_in]=${productIds.join(',')}`);
		}
		filterParts.push(...orParts);
	}

	try {
		const res = await directusServerJson<{ data: any[]; meta?: { filter_count?: number } }>(
			`/items/spk?${filterParts.join('&')}&fields=${SPK_FIELDS}&sort=-tanggal&limit=${limit}&offset=${offset}&meta=filter_count`
		);
		return json({
			data: res?.data || [],
			total: res?.meta?.filter_count ?? (res?.data || []).length
		});
	} catch (e: any) {
		console.error('[api/kiosk/spk] Gagal memuat daftar SPK:', e?.message || e);
		throw error(502, 'Daftar SPK gagal dimuat. Coba lagi.');
	}
};
