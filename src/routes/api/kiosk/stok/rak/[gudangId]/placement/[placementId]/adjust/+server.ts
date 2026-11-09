// src/routes/api/kiosk/stok/rak/[gudangId]/placement/[placementId]/adjust/+server.ts
// Adjustment Opname: hitung fisik satu barang di satu rak langsung menjadi stok sistem.
// Hanya PIC rak (atau rak induknya) dan karyawan bercentang menu Hitung Stok. Bila barang sedang
// masuk sesi opname aktif, hitungan masuk sesi itu dan stok baru berubah setelah review admin.

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { directusServerJson } from '$lib/server/directus';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { adjustOpnameRak, bolehAdjustRak } from '$lib/server/kioskGudang';
import { masukkanKeSesiAktif } from '$lib/server/opnameSesi';

export const POST: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	const gudangId = Number(event.params.gudangId);
	const placementId = Number(event.params.placementId);
	if (!Number.isFinite(gudangId) || gudangId <= 0) throw error(400, 'ID rak tidak valid.');
	if (!Number.isFinite(placementId) || placementId <= 0) throw error(400, 'ID penempatan tidak valid.');

	const body = await event.request.json().catch(() => null);
	const hitungFisik = Number(body?.hitung_fisik);
	const clientTxnId = String(body?.client_txn_id || '').trim();
	if (body?.hitung_fisik === null || body?.hitung_fisik === '' || !Number.isFinite(hitungFisik) || hitungFisik < 0) {
		throw error(400, 'Hitungan fisik wajib angka 0 atau lebih.');
	}
	if (!clientTxnId) throw error(400, 'client_txn_id wajib.');

	let boleh: boolean;
	try {
		const rak = await directusServerJson<{ data: any }>(`/items/gudang/${gudangId}?fields=parent_gudang_id,pic_karyawan_ids`);
		boleh = await bolehAdjustRak(session.karyawanId, rak.data);
	} catch (e) {
		console.error('[api/kiosk/stok/adjust] gagal cek izin', e);
		throw error(503, 'Gagal memeriksa hak akses. Coba lagi.');
	}
	if (!boleh) throw error(403, 'Adjustment hanya untuk PIC rak atau karyawan dengan akses menu Hitung Stok.');

	const placement = await directusServerJson<{ data: any[] }>(
		`/items/gudang_item_placement?filter[id][_eq]=${placementId}&filter[gudang_id][_eq]=${gudangId}&fields=identitas_barang_id&limit=1`
	).catch((e) => {
		console.error('[api/kiosk/stok/adjust] gagal baca penempatan', e);
		throw error(503, 'Gagal membaca data rak. Coba lagi.');
	});
	const itemId = Number(placement?.data?.[0]?.identitas_barang_id);
	if (!itemId) throw error(404, 'Barang tidak ditemukan di rak ini (mungkin sudah dipindah).');

	const masukSesi = await masukkanKeSesiAktif({
		itemId,
		rakId: gudangId,
		hitungFisik,
		karyawanNama: session.nama
	}).catch((e) => {
		console.warn('[api/kiosk/stok/adjust] cek sesi opname gagal, pakai jalur langsung:', e);
		return null;
	});
	if (masukSesi) return json({ ok: true, status: 'masuk_sesi', reference_no: masukSesi.kode });

	const hasil = await adjustOpnameRak({
		gudang_id: gudangId,
		placement_id: placementId,
		hitung_fisik: hitungFisik,
		catatan: body?.catatan ? String(body.catatan).trim().slice(0, 500) : '',
		client_txn_id: clientTxnId,
		karyawan_id: session.karyawanId,
		karyawan_nama: session.nama
	});
	if (!hasil.ok) throw error(hasil.status, hasil.error);
	return json(hasil);
};
