// src/routes/api/kiosk/konsumsi/+server.ts
// Fase 5a, rencana Kiosk Fase 5 -- Menu Lain di Luar QC
// (docs/(eh) rencana-kiosk-menu-lain-fase5, repo erp-epi-1). Proxy TIPIS ke
// POST /api/automation/konsumsi-kiosk -- bisnis logic (bangun/simpan checklist) 100% di
// erp-epi-1, sama pola /api/kiosk/qc. Checklist MURNI INFORMASIONAL, endpoint ini
// tidak pernah menyentuh stok -- lihat catatan di erp-epi-1.
//
// §3.3 (dipertahankan dari pola QC): kiosk_menu_access di-re-verify DI SINI JUGA
// (GET maupun POST), bukan cuma sekali di /kiosk/home.

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { directusServerJson } from '$lib/server/directus';
import { requireKioskSession, type KioskSessionPayload } from '$lib/server/kioskAuth';
import { requireKioskMenu } from '$lib/server/kioskMenuAccess';
import { writeStockMovementServer } from '$lib/server/kioskGudang';

// Audit (audit-kiosk-master-lengkap.md Bagian 2 #5, Sedang): lihat catatan sama di kiosk/qc —
// header ini meneruskan identitas operator supaya rate limit di erp-epi-1 tidak dibagi rata IP.
async function callKonsumsiKiosk(action: string, payload: Record<string, unknown>, actorId?: number) {
	const baseUrl = env.ERP_EPI1_BASE_URL;
	const secret = env.PRODUCTION_AUTOMATION_SECRET;
	if (!baseUrl || !secret) throw error(503, 'ERP_EPI1_BASE_URL/PRODUCTION_AUTOMATION_SECRET belum dikonfigurasi di server.');

	const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/automation/konsumsi-kiosk`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Automation-Secret': secret,
			...(actorId ? { 'X-Kiosk-Actor': String(actorId) } : {})
		},
		body: JSON.stringify({ action, ...payload })
	});
	const data = await res.json().catch(() => null);
	if (!res.ok) throw error(res.status, data?.message || 'Gagal menghubungi layanan konsumsi bahan.');
	return data;
}

export const GET: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	await requireKioskMenu(session.karyawanId, 'konsumsi_bahan', 'Cek Kelengkapan Bahan');

	const spkId = event.url.searchParams.get('spkId');

	// Hanya SPK yang SUDAH mulai produksi (in_progress) yang punya konsumsi OUT-01 untuk
	// dicentang -- beda dari daftar spkAktif di /kiosk/home yang juga mencakup
	// worksheet_generated (belum ada konsumsi apa pun).
	const spkListRes = await directusServerJson<{ data: any[] }>(
		`/items/spk?filter[status][_eq]=in_progress&fields=id,nomor,batch_no,product_id.nama_barang_lengkap&sort=-tanggal&limit=50`
	).catch(() => ({ data: [] }));
	const spkList = spkListRes?.data || [];

	if (!spkId) return json({ spkList });

	const selected = spkList.find((s) => String(s.id) === String(spkId));
	if (!selected) throw error(404, 'SPK tidak ditemukan di daftar sedang produksi.');

	const result = await callKonsumsiKiosk('get_checklist', { spkId: Number(spkId) }, session.karyawanId);
	return json({ spkList, selectedSpk: selected, checklist: result.checklist || [] });
};

export const POST: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	await requireKioskMenu(session.karyawanId, 'konsumsi_bahan', 'Cek Kelengkapan Bahan');

	const body = await event.request.json().catch(() => null);
	const action = body?.action;

	// File 09 Tahap 2 (29 Sep 2026) — dua aksi baru di luar checklist informasional lama:
	// "Bahan kurang" (minta tambahan ke gudang) dan "Ada sisa bahan" (kembalikan ke stok).
	// Keduanya MEMBUAT PERMINTAAN/TRANSAKSI, bukan sekadar centang — jangan campur dengan
	// toggle_item lama, karena itu murni informasional (tidak menyentuh stok).
	if (action === 'request_bahan_kurang') {
		return json(await requestBahanKurang(body, session));
	}
	if (action === 'catat_sisa_bahan') {
		return json(await catatSisaBahan(body, session));
	}

	const spkId = body?.spkId;
	const materialId = body?.materialId;
	const checked = !!body?.checked;
	if (!spkId || materialId == null) throw error(400, 'spkId dan materialId wajib diisi.');

	const result = await callKonsumsiKiosk('toggle_item', {
		spkId: Number(spkId),
		materialId: Number(materialId),
		checked,
		karyawanId: session.karyawanId,
		nama: session.nama
	}, session.karyawanId);
	return json(result);
};

/** File 09 Tahap 2, Bagian B.3 opsi "Bahan kurang" — reuse `packing_list` (koleksi yang sama
 *  dipakai antrian picking Gudang Pusat), BUKAN koleksi baru (dokumen file 09: "Jangan membuat
 *  koleksi baru sebelum dipastikan kedua koleksi tidak cocok"). `status='active'` supaya
 *  otomatis terjaring poller notifikasi PIC gudang yang SUDAH ADA
 *  (`erp-epi/api/automation/gudang-hq-notify?type=antrian_baru`) — tidak perlu bangun jalur
 *  notifikasi baru. Idempotensi: tolak kalau SPK ini masih punya request bahan-kurang pending
 *  (pola sama `fg-request/+server.ts` §A.4), bukan client_txn_id (packing_list tidak punya
 *  kolom itu, dan menambah kolom baru untuk satu jalur ini dianggap berlebihan). */
async function requestBahanKurang(body: any, session: KioskSessionPayload) {
	const spkId = Number(body?.spkId);
	if (!Number.isInteger(spkId) || spkId <= 0) throw error(400, 'spkId tidak valid.');

	const itemsRaw = Array.isArray(body?.items) ? body.items : [];
	const items = itemsRaw
		.map((it: any) => ({
			item_id: Number(it?.itemId),
			nama_barang: typeof it?.namaBarang === 'string' ? it.namaBarang.trim().slice(0, 255) : '',
			qty: Number(it?.qty),
			unit: typeof it?.unit === 'string' ? it.unit.trim().slice(0, 50) : ''
		}))
		.filter((it: any) => Number.isInteger(it.item_id) && it.item_id > 0 && it.qty > 0);
	if (items.length === 0) throw error(400, 'Belum ada bahan yang diisi kekurangannya.');

	const spkRes = await directusServerJson<{ data: any }>(`/items/spk/${spkId}?fields=id,nomor,status`).catch(() => ({ data: null }));
	const spk = spkRes?.data;
	if (!spk) throw error(404, 'SPK tidak ditemukan.');

	// Tolak duplikat: SPK yang sama masih punya request bahan-kurang yang belum diproses gudang.
	const pendingRes = await directusServerJson<{ data: any[] }>(
		`/items/packing_list?filter[spk_id][_eq]=${spkId}&filter[request_type][_eq]=kiosk_bahan_kurang` +
			`&filter[status][_eq]=active&filter[prep_status][_neq]=dispatched&fields=id,nomor_pl&limit=1`
	).catch(() => ({ data: [] }));
	if (pendingRes?.data?.[0]) {
		return { success: true, alreadyDone: true, packingListId: pendingRes.data[0].id, nomorPl: pendingRes.data[0].nomor_pl };
	}

	const now = new Date().toISOString();
	const plRes = await directusServerJson<{ data: any }>('/items/packing_list', {
		method: 'POST',
		body: JSON.stringify({
			request_type: 'kiosk_bahan_kurang',
			spk_id: spkId,
			requested_by_user_id: String(session.karyawanId),
			requested_by_department: 'Produksi',
			request_date: now,
			needed_date: now.slice(0, 10),
			urgency: 'tinggi',
			status: 'active',
			prep_status: 'pending',
			priority: 'tinggi',
			purpose: `Kekurangan bahan SPK ${spk.nomor} — dilaporkan ${session.nama} dari Kiosk Konsumsi Bahan.`,
			total_items: items.length,
			total_qty_required: items.reduce((s: number, it: any) => s + it.qty, 0)
		})
	});
	const pl = plRes?.data;
	if (!pl?.id) throw error(502, 'Gagal membuat permintaan bahan kurang.');

	await directusServerJson('/items/packing_list_items', {
		method: 'POST',
		body: JSON.stringify(
			items.map((it: any) => ({
				packing_list_id: pl.id,
				item_id: it.item_id,
				nama_barang: it.nama_barang || null,
				qty_required: it.qty,
				qty_delivered: 0,
				unit: it.unit || null,
				purpose_notes: `SPK ${spk.nomor}`
			}))
		)
	}).catch(async (e) => {
		// Header sudah terlanjur dibuat tapi baris item gagal — batalkan header supaya gudang
		// tidak melihat antrian kosong tanpa isi (Aturan #1: jangan diam-diam setengah jadi).
		console.error('[kiosk/konsumsi] gagal simpan packing_list_items, membatalkan header', e);
		await directusServerJson(`/items/packing_list/${pl.id}`, {
			method: 'PATCH',
			body: JSON.stringify({ status: 'batal' })
		}).catch(() => {});
		throw error(502, 'Gagal menyimpan rincian bahan kurang. Coba lagi.');
	});

	return { success: true, alreadyDone: false, packingListId: pl.id, nomorPl: pl.nomor_pl };
}

/** File 09 Tahap 2, Bagian B.3 opsi "Ada sisa bahan" — DIPUTUSKAN (29 Sep 2026, keputusan user
 *  menggantikan usulan awal dokumen "reuse retur_gudang"): retur_gudang adalah dokumen lifecycle
 *  4-gate untuk kiriman ANTAR-LOKASI pakai kendaraan (driver_name, vehicle_plate wajib,
 *  security_verified_at oleh satpam) — tidak relevan untuk operator produksi mengembalikan sisa
 *  bahan ke gudang yang sama secara fisik. Sisa bahan dicatat sebagai transaksi IN biasa lewat
 *  `writeStockMovementServer` yang sudah ada (CAS + idempoten + kompensasi, sama seperti file 05),
 *  kategori baru `KONSUMSI_SISA` supaya bisa dibedakan dari OPNAME_ADJ/HQ_PICK_OUT di laporan. */
async function catatSisaBahan(body: any, session: KioskSessionPayload) {
	const spkId = Number(body?.spkId);
	const itemId = Number(body?.itemId);
	const qty = Number(body?.qty);
	const clientTxnId = typeof body?.clientTxnId === 'string' ? body.clientTxnId.trim() : '';
	if (!Number.isInteger(spkId) || spkId <= 0) throw error(400, 'spkId tidak valid.');
	if (!Number.isInteger(itemId) || itemId <= 0) throw error(400, 'Item bahan tidak valid.');
	if (!(qty > 0)) throw error(400, 'Qty sisa harus lebih dari 0.');
	if (!clientTxnId) throw error(400, 'clientTxnId wajib diisi (idempotensi).');

	const spkRes = await directusServerJson<{ data: any }>(`/items/spk/${spkId}?fields=id,nomor`).catch(() => ({ data: null }));
	const spk = spkRes?.data;
	if (!spk) throw error(404, 'SPK tidak ditemukan.');

	const mv = await writeStockMovementServer({
		itemId,
		type: 'IN',
		quantity: qty,
		category: 'KONSUMSI_SISA',
		notes: `Sisa bahan SPK ${spk.nomor} dikembalikan oleh ${session.nama} dari Kiosk Konsumsi Bahan`,
		karyawanId: session.karyawanId,
		karyawanNama: session.nama,
		clientTxnId,
		referenceType: 'SPK',
		referenceId: spkId
	});

	return {
		success: true,
		alreadyDone: mv.already_done,
		newStock: mv.new_stock,
		referenceNo: mv.reference_no
	};
}
