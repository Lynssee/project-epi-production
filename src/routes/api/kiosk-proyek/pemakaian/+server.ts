// src/routes/api/kiosk-proyek/pemakaian/+server.ts
// Kru mengajukan DRAF pemakaian barang dari kiosk: pilih barang stok proyek + jumlah (+ foto).
// (Rencana Kiosk Proyek, Fase 5.) Draf TIDAK menyentuh stok: project_expenses & ledger tidak ditulis di sini.
// Leader memasukkannya ke Laporan Harian (material_used); stok baru berkurang saat laporan disimpan lewat penulis
// pemakaian yang sudah ada — sehingga tidak ada jalur kedua yang bisa memotong stok dua kali.
// Nama/satuan/identitas barang DISALIN dari project_expenses di server; klien hanya mengirim expense_id + jumlah.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRateLimited } from '$lib/server/rateLimit';
import { authPerangkatKiosk } from '$lib/server/kioskProyekAuth';
import { getRoster, touchDevice } from '$lib/server/kioskProyekDevice';
import { todayWIB } from '$lib/server/kioskProyekToken';
import { unggahFoto } from '$lib/server/manpowerAbsensiCore';
import { cariDrafKembar, daftarBarangProyek, jumlahDrafHariIni, simpanDraf } from '$lib/server/kioskPemakaian';
import { PEMAKAIAN_CATATAN_MAKS, parseQty } from '$lib/utils/kioskPemakaian';

const MAX_FOTO_BYTES = 2 * 1024 * 1024;

export const POST: RequestHandler = async (event) => {
	const auth = await authPerangkatKiosk(event);
	if (!auth.ok) return auth.response;
	const { settings, row, deviceId, projectId } = auth;
	if (!settings['kiosk_proyek.pemakaian_aktif']) throw error(403, 'Pakai Barang sedang dimatikan oleh admin.');
	if (isRateLimited(`kp-pemakaian-dev:${deviceId}`, { windowMs: 5 * 60 * 1000, max: 30 })) {
		throw error(429, 'Terlalu banyak pengajuan dalam waktu singkat dari perangkat ini. Tunggu sebentar.');
	}

	const form = await event.request.formData();
	const pribadi = row.jenis === 'pribadi';
	const pemilik = pribadi ? Number(row.manpower_id) : null;
	const diminta = form.get('manpower_id');
	if (pribadi && diminta != null && diminta !== '' && Number(diminta) !== pemilik) {
		throw error(403, 'HP pribadi hanya bisa dipakai untuk pengajuan atas nama sendiri.');
	}
	const manpowerId = pribadi ? (pemilik as number) : Number(diminta);
	if (!Number.isInteger(manpowerId) || manpowerId <= 0) throw error(400, 'Pilih nama Anda.');

	const expenseId = Number(form.get('expense_id'));
	if (!Number.isInteger(expenseId) || expenseId <= 0) throw error(400, 'Pilih barang.');
	const qty = parseQty(form.get('qty'));
	if (qty == null) throw error(400, 'Jumlah harus angka lebih dari 0 (maksimal 3 desimal).');

	const catatan = String(form.get('catatan') || '').trim();
	if (catatan.length > PEMAKAIAN_CATATAN_MAKS) throw error(400, `Catatan maksimal ${PEMAKAIAN_CATATAN_MAKS} karakter.`);
	const foto = form.get('foto');
	const adaFoto = foto instanceof File && foto.size > 0;
	if (!adaFoto && settings['kiosk_proyek.pemakaian_foto_wajib']) throw error(400, 'Foto wajib. Ambil foto barang/pemakaian langsung dari kamera.');
	if (adaFoto && (foto as File).size > MAX_FOTO_BYTES) throw error(413, 'Foto terlalu besar. Coba ambil ulang.');

	// Pengaju harus kru terdaftar di proyek ini; barang harus ada di stok proyek ini (sisa dibaca server, bukan klien).
	const cacheDetik = settings['kiosk_proyek.roster_cache_detik'];
	const roster = await getRoster(projectId, cacheDetik);
	const kru = roster.kru.find((k) => k.manpower_id === manpowerId);
	if (!kru) throw error(403, 'Nama ini tidak terdaftar di proyek ini.');

	const barang = (await daftarBarangProyek(projectId, cacheDetik)).find((b) => b.expense_id === expenseId);
	if (!barang) throw error(404, 'Barang tidak ada di stok proyek ini atau stoknya sudah habis.');
	if (qty > barang.sisa) throw error(422, `Jumlah melebihi sisa stok (${barang.sisa} ${barang.satuan}). Cek ulang jumlahnya.`);

	const tanggal = todayWIB();
	const kembar = await cariDrafKembar(projectId, manpowerId, tanggal, expenseId, qty);
	if (kembar) return json({ ok: true, id: kembar, sudah_ada: true }, { headers: { 'Cache-Control': 'no-store' } });

	const batas = settings['kiosk_proyek.pemakaian_maks_per_orang_per_hari'];
	if (batas > 0 && (await jumlahDrafHariIni(projectId, manpowerId, tanggal)) >= batas) {
		throw error(429, `Batas ${batas} draf per hari untuk ${kru.nama} sudah tercapai. Sampaikan ke leader.`);
	}

	const fotoId = adaFoto ? await unggahFoto(foto as File, `pemakaian-${manpowerId}-${tanggal}.jpg`, `kp-pemakaian:${projectId}:${tanggal}`) : null;
	const id = await simpanDraf({ projectId, manpowerId, tanggal, barang, qty, catatan, fotoId, perangkatId: deviceId, dicatatOleh: kru.nama });

	touchDevice(deviceId);
	return json({ ok: true, id, sudah_ada: false }, { headers: { 'Cache-Control': 'no-store' } });
};
