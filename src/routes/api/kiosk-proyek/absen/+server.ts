// src/routes/api/kiosk-proyek/absen/+server.ts
// Absen HADIR / PULANG dari perangkat kiosk proyek (Rencana Kiosk Proyek, Fase 2; HP pribadi Fase 3).
// Identitas perangkat = cookie HMAC (Fase 1); orang yang diabsen dipilih di layar. Karena itu
// SEMUA keputusan ada di server: jam = jam server, jarak dihitung server, foto wajib, dan hasilnya
// selalu masuk antrean verifikasi leader dengan penanda anomali bila ada.
//
// Logika tulis + akrual dipakai bersama dengan absen-regu ($lib/server/manpowerAbsensiCore).
// Gate (mode dari gate_definitions, diatur superadmin di /settings/gates — bukan hardcode):
//   G_KSP_ABSEN_JENDELA_JAM  — absen di luar jam yang diatur
//   G_KSP_ABSEN_REKAN_BATAS  — satu perangkat mengabsenkan terlalu banyak orang hari ini
//   G_KSP_FOTO_HASH_GANDA    — foto identik dipakai ulang
//   G_KSP_ABSEN_GEOFENCE     — mengikuti manpower.geofence.<konteks> (lihat core), tidak ada setelan ganda

import { error, json } from '@sveltejs/kit';
import { createHash } from 'node:crypto';
import type { RequestHandler } from './$types';
import { isRateLimited } from '$lib/server/rateLimit';
import { directusServerJson } from '$lib/server/directus';
import { resolveGateMode } from '$lib/server/gateDefinitionsMode';
import { getKioskProyekSettings } from '$lib/server/kioskProyekSettings';
import { invalidateRoster, kioskProyekSecret, touchDevice, validateDevice } from '$lib/server/kioskProyekDevice';
import { KIOSK_PROYEK_COOKIE, todayWIB, verifyDeviceCookie } from '$lib/server/kioskProyekToken';
import { catatAbsenMasuk, catatAbsenPulang } from '$lib/server/manpowerAbsensiCore';
import { FOTO_HASH_PREFIX, cekJendela, keputusanGate, type GateMode } from '$lib/utils/kioskProyekAbsen';
import { KIOSK_FLAG_LABEL, type KioskFlag } from '$lib/shared/kioskFlags';

const DOC_TYPE = 'absensi_kiosk';
const MAX_FOTO_BYTES = 2 * 1024 * 1024; // sabuk pengaman; kompresi klien menargetkan ±150 KB

const deny = (reason: string, status: number) => json({ ok: false, reason }, { status, headers: { 'Cache-Control': 'no-store' } });

async function modeGate(key: string): Promise<GateMode> {
	return (await resolveGateMode(key, DOC_TYPE).catch(() => 'soft')) as GateMode;
}

/** Foto yang sama (hash identik) sudah pernah diunggah lewat kiosk? Gagal baca → anggap tidak (dilog). */
async function fotoSudahDipakai(hash: string): Promise<boolean> {
	try {
		const q = new URLSearchParams({ 'filter[title][_eq]': FOTO_HASH_PREFIX + hash, fields: 'id', limit: '1' });
		const r = await directusServerJson<{ data: any[] }>(`/files?${q.toString()}`);
		return (r?.data?.length || 0) > 0;
	} catch (e) {
		console.warn('[kiosk-proyek/absen] cek foto ganda gagal (dilewati):', (e as Error)?.message);
		return false;
	}
}

async function jumlahDiabsenkanPerangkat(projectId: number, tanggal: string, prefix: string): Promise<number> {
	try {
		const q = new URLSearchParams({
			'filter[project_id][_eq]': String(projectId),
			'filter[tanggal][_eq]': tanggal,
			'filter[dicatat_oleh][_starts_with]': prefix,
			'aggregate[count]': '*'
		});
		const r = await directusServerJson<{ data: any[] }>(`/items/manpower_absensi?${q.toString()}`);
		return Number(r?.data?.[0]?.count ?? 0) || 0;
	} catch (e) {
		console.warn('[kiosk-proyek/absen] hitung absen-rekan gagal (dilewati):', (e as Error)?.message);
		return 0;
	}
}

export const POST: RequestHandler = async (event) => {
	const settings = await getKioskProyekSettings();
	if (!settings['kiosk_proyek.aktif']) return deny('kiosk_mati', 403);

	const device = verifyDeviceCookie(event.cookies.get(KIOSK_PROYEK_COOKIE), kioskProyekSecret());
	if (!device) return deny('belum_aktif', 401);
	const row = await validateDevice(device.d, device.p);
	if (!row) {
		event.cookies.delete(KIOSK_PROYEK_COOKIE, { path: '/' });
		return deny('perangkat_tidak_sah', 401);
	}

	// Batas laju per PERANGKAT (bukan per IP: satu pos jaga = satu IP untuk puluhan kru).
	if (isRateLimited(`kp-absen-dev:${device.d}`, { windowMs: 5 * 60 * 1000, max: 60 })) {
		throw error(429, 'Terlalu banyak absen dalam waktu singkat dari perangkat ini. Tunggu sebentar.');
	}

	const form = await event.request.formData();
	const aksi = String(form.get('aksi') || '');
	// HP pribadi (Fase 3) hanya boleh mengabsenkan pemiliknya; identitas diambil dari baris perangkat
	// di server, bukan dari kiriman klien. Kiosk bersama: orang dipilih di layar.
	const pribadi = row.jenis === 'pribadi';
	const pemilik = pribadi ? Number(row.manpower_id) : null;
	const diminta = form.get('manpower_id');
	if (pribadi && diminta != null && diminta !== '' && Number(diminta) !== pemilik) {
		throw error(403, 'HP pribadi hanya bisa dipakai untuk absen diri sendiri.');
	}
	const manpowerId = pribadi ? (pemilik as number) : Number(diminta);
	const lat = Number(form.get('lat'));
	const lng = Number(form.get('lng'));
	const accuracy = form.get('accuracy') != null && form.get('accuracy') !== '' ? Number(form.get('accuracy')) : null;
	const foto = form.get('foto');

	if (aksi !== 'masuk' && aksi !== 'pulang') throw error(400, 'aksi harus "masuk" atau "pulang".');
	if (!Number.isInteger(manpowerId) || manpowerId <= 0) throw error(400, 'manpower_id tidak valid.');
	if (!(foto instanceof File) || foto.size === 0) throw error(400, 'Foto bukti wajib. Ambil foto langsung dari kamera.');
	if (foto.size > MAX_FOTO_BYTES) throw error(413, 'Foto terlalu besar. Coba ambil ulang.');

	const projectId = device.p;
	const tanggal = todayWIB(); // jam SERVER, bukan jam HP
	const now = new Date();
	const project = await directusServerJson<{ data: any }>(`/items/projects/${projectId}?fields=id,name,geo_lat,geo_lng,geo_radius_m`).then((r) => r?.data);
	if (!project) throw error(404, 'Proyek tidak ditemukan.');

	const flags: KioskFlag[] = [];
	const pencatatNama = `Kiosk#${device.d} ${row.label || 'perangkat'}`.slice(0, 120);

	/** Terapkan satu gate: hard → tolak; warn/soft → tandai; shadow → hanya jejak log. */
	const terapkan = async (gateKey: string, flag: KioskFlag, pelanggaran: boolean, pesanTolak: string) => {
		if (!pelanggaran) return;
		const k = keputusanGate(await modeGate(gateKey));
		if (k.tolak) throw error(422, pesanTolak);
		if (k.tandai) flags.push(flag);
		else if (k.catat) console.info(`[kiosk-proyek/absen] shadow ${gateKey}: perangkat #${device.d}, manpower #${manpowerId}, ${tanggal}`);
	};

	// Foto: hash untuk deteksi pemakaian ulang; judul file = penanda agar foto berikutnya bisa dicocokkan.
	const hash = createHash('sha256').update(Buffer.from(await foto.arrayBuffer())).digest('hex');

	const gatesUmum = async () => {
		const jendela = cekJendela(aksi, now, settings);
		await terapkan('G_KSP_ABSEN_JENDELA_JAM', 'jendela_jam', !jendela.ok, jendela.alasan || 'Di luar jam absen.');
		await terapkan('G_KSP_FOTO_HASH_GANDA', 'foto_ganda', await fotoSudahDipakai(hash), 'Foto ini sama dengan foto absen sebelumnya. Ambil foto baru langsung dari kamera.');
	};

	let hasil;
	if (aksi === 'masuk') {
		hasil = await catatAbsenMasuk({
			projectId,
			project,
			assignmentId: null,
			targetManpowerId: manpowerId,
			status: 'hadir',
			tanggal,
			lat,
			lng,
			accuracy,
			foto,
			pencatat: pribadi
				? { metode: 'kiosk_mandiri', nama: pencatatNama, manpowerId: pemilik }
				: { metode: 'kiosk_rekan', nama: pencatatNama, manpowerId: null },
			existingPolicy: 'idempotent',
			flags,
			fotoTitle: FOTO_HASH_PREFIX + hash,
			// Dijalankan setelah penugasan & idempotensi lolos, sebelum foto diunggah: ulang-tekan = no-op bersih.
			sebelumTulis: async () => {
				await gatesUmum();
				// Batas absen-rekan hanya relevan untuk kiosk bersama; HP pribadi mengabsenkan satu orang saja.
				const batas = pribadi ? 0 : settings['kiosk_proyek.absen_rekan_batas_per_hari'];
				if (batas > 0) {
					const sudah = await jumlahDiabsenkanPerangkat(projectId, tanggal, `Kiosk#${device.d} `);
					await terapkan('G_KSP_ABSEN_REKAN_BATAS', 'rekan_batas', sudah >= batas, `Perangkat ini sudah mengabsenkan ${sudah} orang hari ini (batas ${batas}). Minta leader mengabsenkan.`);
				}
			}
		});
	} else {
		// Gerbang dijalankan SETELAH idempotensi (sama seperti masuk): kirim ulang setelah respons hilang = no-op bersih,
		// bukan ditolak "foto ganda" oleh foto yang baru saja kita simpan sendiri.
		hasil = await catatAbsenPulang({ projectId, project, targetManpowerId: manpowerId, tanggal, lat, lng, accuracy, foto, flags, fotoTitle: FOTO_HASH_PREFIX + hash, sebelumTulis: gatesUmum });
	}

	invalidateRoster(projectId);
	touchDevice(device.d);

	return json(
		{
			ok: true,
			aksi,
			sudah_ada: hasil.sudahAda,
			message: hasil.message,
			masuk_valid: hasil.masuk_valid,
			jarak_m: hasil.jarak_m,
			peringatan: flags.map((f) => KIOSK_FLAG_LABEL[f]),
			jam: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
		},
		{ headers: { 'Cache-Control': 'no-store' } }
	);
};
