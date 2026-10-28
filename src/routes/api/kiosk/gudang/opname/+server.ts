// src/routes/api/kiosk/gudang/opname/+server.ts
// Submit opname (hitung fisik vs sistem) dari Kiosk Gudang. Selisih dalam toleransi langsung
// diterapkan; di luar toleransi masuk inbox verifikasi lapangan. Guard: sesi kiosk.
// Fase 3, rencana "Penajaman Kiosk Inventory" (8 Sep 2026).
// File 06 (29 Sep 2026), §2.1-2.2 — opname per rak (Keputusan Lead opsi A): operator memilih/
// scan rak dulu, dibandingkan dengan SALDO RAK (ledger), bukan stok global. Server menghitung
// ULANG pembanding saat submit (bukan percaya nilai yang klien tampilkan saat layar dibuka) —
// kalau sudah berubah (ada pick/transfer di antaranya), tolak 409 dan minta hitung ulang.

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { directusServerJson } from '$lib/server/directus';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { requireKioskMenu } from '$lib/server/kioskMenuAccess';
import { submitOpnameKiosk, readGudangHqGate } from '$lib/server/kioskGudang';
import { fetchLedgerQtyForGudang } from '$lib/server/kioskStok';
import { parseStok } from '$lib/utils/stokFormat';
import { masukkanKeSesiAktif } from '$lib/server/opnameSesi';

export const POST: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	await requireKioskMenu(session.karyawanId, 'gudang_opname', 'Hitung Stok (Opname)');
	const body = await event.request.json().catch(() => null);
	if (!body) throw error(400, 'Body tidak valid.');

	const item_id = Number(body.item_id);
	const rak_id = Number(body.rak_id);
	const hasRak = Number.isFinite(rak_id) && rak_id > 0;
	// stok_sistem boleh kosong HANYA untuk item dalam sesi opname blind (server tidak mengirim stok ke layar kiosk).
	const adaStokDitampilkan = body.stok_sistem !== null && body.stok_sistem !== undefined && Number.isFinite(Number(body.stok_sistem));
	const stok_ditampilkan = Number(body.stok_sistem);
	const hitung_fisik = Number(body.hitung_fisik);
	const client_txn_id = String(body.client_txn_id || '').trim();
	if (!Number.isFinite(item_id) || item_id <= 0) throw error(400, 'Barang tidak valid.');
	if (!Number.isFinite(hitung_fisik) || hitung_fisik < 0) throw error(400, 'Hitungan fisik wajib angka >= 0.');
	if (!client_txn_id) throw error(400, 'client_txn_id wajib.');

	// Idempotensi DULU, sebelum recompute-and-compare di bawah — retry (jaringan putus setelah
	// sukses) akan membandingkan stok_ditampilkan (nilai LAMA sebelum submit pertama) dengan
	// ledger yang SUDAH berubah akibat submit pertama, dan salah dibalas 409 kalau urutan
	// dibalik. writeStockMovementServer sendiri sudah idempoten by client_txn_id.
	const existing = await directusServerJson<{ data: any[] }>(
		`/items/stock_transactions?filter[client_txn_id][_eq]=${encodeURIComponent(client_txn_id)}&fields=id,previous_stock,new_stock,reference_no,status,verification_status&limit=1`
	).catch((e) => {
		console.error('[kiosk/gudang/opname] gagal cek idempotensi', e);
		throw error(503, 'Server sibuk, coba lagi.');
	});
	if (existing?.data?.[0]) {
		const row = existing.data[0];
		const delta = Number(row.new_stock) - Number(row.previous_stock);
		return json({
			ok: true,
			status: row.verification_status === 'pending' ? 'menunggu_approval' : delta === 0 ? 'no_change' : 'auto_approved',
			delta,
			delta_pct: 0,
			reference_no: row.reference_no,
			already_done: true
		});
	}

	if (hasRak) {
		// Validasi rak.id adalah rak/zona (punya parent), sama seperti pindahRak.
		const rakRows = await directusServerJson<{ data: any[] }>(
			`/items/gudang?filter[id][_eq]=${rak_id}&fields=id,parent_gudang_id&limit=1`
		).catch((e) => {
			console.error('[kiosk/gudang/opname] gagal validasi rak', e);
			throw error(503, 'Gagal memeriksa data rak. Coba lagi.');
		});
		const rak = rakRows?.data?.[0];
		if (!rak) throw error(404, 'Rak tidak ditemukan.');
		if (!rak.parent_gudang_id) throw error(400, 'Hitung Stok per rak hanya untuk rak/zona, bukan gudang level teratas.');
	}

	// Tahap 6 F4 — bila ada sesi opname "Menghitung" yang memuat (rak,item) ini (dan mode session menyala), hitungan MASUK SESI:
	// penyesuaian stok baru diposting setelah review & approval admin, bukan langsung. Dicek SEBELUM pembanding stok di bawah:
	// pada sesi blind klien memang tidak punya stok_sistem, dan pembanding sesi (snapshot + mutasi) dihitung erp-epi saat "Tutup Hitung".
	// Gagal baca sesi -> jalur langsung (log jelas), bukan menelan diam-diam.
	const masukSesi = await masukkanKeSesiAktif({
		itemId: item_id,
		rakId: hasRak ? rak_id : null,
		hitungFisik: hitung_fisik,
		karyawanNama: session.nama
	}).catch((e) => {
		console.warn('[kiosk/gudang/opname] cek sesi opname gagal, pakai jalur langsung:', e);
		return null;
	});
	if (masukSesi) {
		return json({ ok: true, status: 'masuk_sesi', delta: 0, delta_pct: 0, reference_no: masukSesi.kode, sesi: masukSesi.kode });
	}
	if (!adaStokDitampilkan) {
		// layar dibuka saat sesi blind aktif, tapi sesi sudah ditutup/dibatalkan sebelum submit
		throw error(409, 'Sesi opname untuk barang ini sudah ditutup. Muat ulang barang ini lalu hitung lagi.');
	}

	// §2.2 — hitung ulang pembanding saat submit, JANGAN percaya nilai yang klien tampilkan
	// saat layar dibuka (bisa basi karena ada pick/transfer di antaranya).
	let sistemSekarang: number;
	if (hasRak) {
		const ledger = await fetchLedgerQtyForGudang(rak_id, [item_id]);
		sistemSekarang = ledger.get(item_id) ?? 0;
	} else {
		const rows = await directusServerJson<{ data: any[] }>(
			`/items/identitas_barang?filter[id][_eq]=${item_id}&fields=stok_tersedia&limit=1`
		).catch((e) => {
			console.error('[kiosk/gudang/opname] gagal baca stok terkini', e);
			throw error(503, 'Gagal memeriksa stok terkini. Coba lagi.');
		});
		sistemSekarang = parseStok(rows?.data?.[0]?.stok_tersedia);
	}

	if (Math.abs(sistemSekarang - stok_ditampilkan) > 0.0001) {
		throw error(
			409,
			`Stok tercatat berubah dari ${stok_ditampilkan} menjadi ${sistemSekarang} sejak Anda membuka layar. Hitung ulang barang ini.`
		);
	}

	const gate = await readGudangHqGate();
	const result = await submitOpnameKiosk(
		{
			item_id,
			stok_sistem: sistemSekarang,
			hitung_fisik,
			catatan: body.catatan ? String(body.catatan).trim().slice(0, 500) : '',
			client_txn_id,
			karyawan_id: session.karyawanId,
			karyawan_nama: session.nama,
			rak_id: hasRak ? rak_id : null
		},
		{ toleransiPct: gate.opname_toleransi_pct, wajibApproval: gate.opname_wajib_approval }
	);

	if (!result.ok) throw error(result.status ?? 400, result.error);
	return json(result);
};
