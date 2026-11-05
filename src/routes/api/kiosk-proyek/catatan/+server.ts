// src/routes/api/kiosk-proyek/catatan/+server.ts
// Kru mengirim "Catatan Kerja" dari kiosk: foto + pilihan cepat + 1-2 kalimat (Rencana Kiosk Proyek, Fase 4).
// BUKAN laporan resmi (tanpa skor/review/revisi) — hanya masukan; leader yang memutuskan memakainya di Laporan Harian.
// Identitas: kiosk bersama = orang dipilih di layar (wajib terdaftar di proyek); HP pribadi = pemilik perangkat saja.
// Tidak ada gate baru: batasan hanya validasi dasar + batas harian yang diatur di setelan (bukan hardcode).

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRateLimited } from '$lib/server/rateLimit';
import { getKioskProyekSettings } from '$lib/server/kioskProyekSettings';
import { getRoster, kioskProyekSecret, touchDevice, validateDevice } from '$lib/server/kioskProyekDevice';
import { KIOSK_PROYEK_COOKIE, todayWIB, verifyDeviceCookie } from '$lib/server/kioskProyekToken';
import { unggahFoto } from '$lib/server/manpowerAbsensiCore';
import { cariCatatanByFoto, cariCatatanKembarTeks, cariFileByJudul, jumlahCatatanHariIni, simpanCatatan } from '$lib/server/kioskCatatan';
import { CATATAN_MAKS_KARAKTER, namaKategoriResmi, tentukanJenis } from '$lib/utils/kioskCatatan';
import { txnIdValid } from '$lib/utils/kioskProyekRetry';

const MAX_FOTO_BYTES = 2 * 1024 * 1024;
const deny = (reason: string, status: number) => json({ ok: false, reason }, { status, headers: { 'Cache-Control': 'no-store' } });

export const POST: RequestHandler = async (event) => {
	const settings = await getKioskProyekSettings();
	if (!settings['kiosk_proyek.aktif']) return deny('kiosk_mati', 403);
	if (!settings['kiosk_proyek.catatan_aktif']) throw error(403, 'Catatan Kerja sedang dimatikan oleh admin.');

	const device = verifyDeviceCookie(event.cookies.get(KIOSK_PROYEK_COOKIE), kioskProyekSecret());
	if (!device) return deny('belum_aktif', 401);
	const row = await validateDevice(device.d, device.p);
	if (!row) {
		event.cookies.delete(KIOSK_PROYEK_COOKIE, { path: '/' });
		return deny('perangkat_tidak_sah', 401);
	}
	if (isRateLimited(`kp-catatan-dev:${device.d}`, { windowMs: 5 * 60 * 1000, max: 30 })) {
		throw error(429, 'Terlalu banyak catatan dalam waktu singkat dari perangkat ini. Tunggu sebentar.');
	}

	const form = await event.request.formData();
	const pribadi = row.jenis === 'pribadi';
	const pemilik = pribadi ? Number(row.manpower_id) : null;
	const diminta = form.get('manpower_id');
	if (pribadi && diminta != null && diminta !== '' && Number(diminta) !== pemilik) {
		throw error(403, 'HP pribadi hanya bisa dipakai untuk catatan atas nama sendiri.');
	}
	const manpowerId = pribadi ? (pemilik as number) : Number(diminta);
	if (!Number.isInteger(manpowerId) || manpowerId <= 0) throw error(400, 'Pilih nama Anda.');

	const progres = settings['kiosk_proyek.catatan_kategori_progres'];
	const kendala = settings['kiosk_proyek.catatan_kategori_kendala'];
	const kategoriRaw = String(form.get('kategori') || '');
	const jenis = tentukanJenis(kategoriRaw, progres, kendala);
	if (!jenis) throw error(400, 'Pilih jenis catatan dari daftar.');

	const teks = String(form.get('catatan') || '').trim();
	if (teks.length > CATATAN_MAKS_KARAKTER) throw error(400, `Catatan maksimal ${CATATAN_MAKS_KARAKTER} karakter.`);
	const foto = form.get('foto');
	const adaFoto = foto instanceof File && foto.size > 0;
	if (!adaFoto && !teks) throw error(400, 'Isi catatan atau lampirkan foto.');
	if (adaFoto && (foto as File).size > MAX_FOTO_BYTES) throw error(413, 'Foto terlalu besar. Coba ambil ulang.');

	// Orang yang menulis harus terdaftar di proyek ini (cache roster — tidak menambah beban Directus).
	const roster = await getRoster(device.p, settings['kiosk_proyek.roster_cache_detik']);
	const kru = roster.kru.find((k) => k.manpower_id === manpowerId);
	if (!kru) throw error(403, 'Nama ini tidak terdaftar di proyek ini.');

	const tanggal = todayWIB();
	const kategoriResmi = namaKategoriResmi(kategoriRaw, progres, kendala);

	// Kirim ulang aman (pasca sinyal putus): foto dikenali lewat id transaksi di judul file; hanya-teks lewat isi yang sama < 2 menit.
	// Dicek SEBELUM batas harian & unggah, jadi kirim ulang tidak memakan jatah dan tidak membuat foto/baris ganda.
	const txn = form.get('txn_id');
	const judulFoto = `kp-catatan:${device.p}:${tanggal}${txnIdValid(txn) ? `:${txn}` : ''}`;
	let fotoSudahAda: string | null = null;
	if (adaFoto && txnIdValid(txn)) {
		fotoSudahAda = await cariFileByJudul(judulFoto);
		if (fotoSudahAda) {
			const barisAda = await cariCatatanByFoto(device.p, fotoSudahAda);
			if (barisAda) return json({ ok: true, id: barisAda, jenis, sudah_ada: true }, { headers: { 'Cache-Control': 'no-store' } });
		}
	} else if (!adaFoto) {
		const kembar = await cariCatatanKembarTeks(device.p, manpowerId, tanggal, kategoriResmi, teks);
		if (kembar) return json({ ok: true, id: kembar, jenis, sudah_ada: true }, { headers: { 'Cache-Control': 'no-store' } });
	}

	const batas = settings['kiosk_proyek.catatan_maks_per_orang_per_hari'];
	if (batas > 0 && (await jumlahCatatanHariIni(device.p, manpowerId, tanggal)) >= batas) {
		throw error(429, `Batas ${batas} catatan per hari untuk ${kru.nama} sudah tercapai. Sampaikan ke leader.`);
	}

	// File sudah ada tapi barisnya belum (proses putus di antara unggah dan simpan) → pakai ulang, jangan unggah lagi.
	const fotoId = adaFoto ? (fotoSudahAda ?? (await unggahFoto(foto as File, `catatan-${manpowerId}-${tanggal}.jpg`, judulFoto))) : null;
	const id = await simpanCatatan({
		projectId: device.p,
		manpowerId,
		tanggal,
		jenis,
		kategori: kategoriResmi,
		catatan: teks,
		fotoId,
		perangkatId: device.d,
		dicatatOleh: kru.nama
	});

	touchDevice(device.d);
	return json({ ok: true, id, jenis, sudah_ada: false }, { headers: { 'Cache-Control': 'no-store' } });
};
