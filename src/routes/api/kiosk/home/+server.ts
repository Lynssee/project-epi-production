// src/routes/api/kiosk/home/+server.ts
// Data layar /kiosk/home — pengumuman aktif + SPK yang sedang berjalan. Fase 2, rencana
// Optimasi Inventory & Produksi + Deposit HP + Kiosk Produksi v2 (24 Agu 2026).

import { json, type RequestHandler } from '@sveltejs/kit';
import { directusServerJson } from '$lib/server/directus';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { todayWib } from '$lib/utils/wibDate';

async function readSetting<T>(key: string, fallback: T): Promise<T> {
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/system_settings?filter[setting_key][_eq]=${encodeURIComponent(key)}&limit=1`
		);
		const raw = res?.data?.[0]?.setting_value;
		if (raw === undefined || raw === null || raw === '') return fallback;
		try {
			return JSON.parse(raw) as T;
		} catch {
			return raw as T;
		}
	} catch {
		return fallback;
	}
}

/** Fase 3D — id jadwal shift operator hari ini: shift_roster dulu, fallback jadwal statis
 *  karyawan. Dua query terpisah (Aturan #2). Boleh gagal/kosong (null) tanpa error ke klien. */
async function resolveJadwalKerjaId(karyawanId: number, today: string): Promise<string | null> {
	try {
		const rosterRes = await directusServerJson<{ data: any[] }>(
			`/items/shift_roster?filter[karyawan_id][_eq]=${karyawanId}&filter[tanggal][_eq]=${today}` +
				`&filter[status][_eq]=aktif&fields=jadwal_kerja_id&limit=1`
		);
		const fromRoster = rosterRes?.data?.[0]?.jadwal_kerja_id;
		if (fromRoster) return typeof fromRoster === 'object' ? fromRoster.id : fromRoster;
	} catch {
		/* lanjut ke fallback */
	}
	try {
		const karyawanRes = await directusServerJson<{ data: any }>(`/items/karyawan/${karyawanId}?fields=jadwal_kerja_id`);
		const fromKaryawan = karyawanRes?.data?.jadwal_kerja_id;
		if (fromKaryawan) return typeof fromKaryawan === 'object' ? fromKaryawan.id : fromKaryawan;
	} catch {
		/* biarkan null — UI menampilkan "Shift belum terdeteksi" */
	}
	return null;
}

export const GET: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	// Bug 3 rencana "Pertajam Modul Kiosk Produksi v2" (12 Sep 2026) — kalender WIB, bukan UTC.
	// Sebelum jam 07:00 WIB tanggal UTC masih hari kemarin, sehingga pengumuman yang sudah
	// kedaluwarsa kemarin tetap tampil di layar kiosk sepanjang shift malam.
	const today = todayWib();

	// File 03 §3.2 — beranda cukup butuh JUMLAH SPK per kelompok, bukan 20 baris data (daftar
	// lengkap sekarang dimuat lewat /api/kiosk/spk?kelompok=... di kiosk/input-produksi).
	// Satu query agregat dikelompokkan per status (hemat API — Aturan CLAUDE.md), bukan dua
	// round-trip terpisah. spkError tetap dipertahankan (dipakai beranda, lihat file 11).
	const spkPromise = directusServerJson<{ data: any[] }>(
		`/items/spk?filter[status][_in]=in_progress,worksheet_generated,waiting_for_stock&aggregate[count]=id&groupBy[]=status`
	)
		.then((res) => {
			let berjalan = 0;
			let belumMulai = 0;
			for (const row of res?.data || []) {
				const n = Number(row?.count?.id) || 0;
				if (row.status === 'in_progress') berjalan += n;
				else belumMulai += n;
			}
			return { berjalan, belumMulai, error: false };
		})
		.catch((e) => {
			console.error('[api/kiosk/home] Gagal memuat jumlah SPK aktif:', e?.message || e);
			return { berjalan: 0, belumMulai: 0, error: true };
		});

	const [announcementsRes, spkResult, timeoutMinutes, karyawanRes, jadwalKerjaIdResolved, jadwalOptionsRes, equipmentOptionsRes] =
		await Promise.all([
			directusServerJson<{ data: any[] }>(
				`/items/doc_announcements?filter[status][_eq]=published&filter[_or][0][tanggal_kedaluwarsa][_null]=true&filter[_or][1][tanggal_kedaluwarsa][_gte]=${today}&sort=-tanggal_publikasi&limit=5`
			).catch(() => ({ data: [] })),
			spkPromise,
			readSetting<number>('kiosk.session_timeout_minutes', 5),
			// Fase 0, rencana Kiosk QC Produksi (8 Sep 2026) -- sesi kiosk TIDAK membawa info menu
			// (§1), jadi kioskMenuAccess dibaca ulang dari Directus tiap kali /kiosk/home dimuat.
			// Ini HANYA dipakai untuk tampil/sembunyi tombol -- endpoint /api/kiosk/qc tetap
			// re-verify sendiri (§3.3), tidak percaya field ini datang dari klien.
			directusServerJson<{ data: any[] }>(
				`/items/karyawan?filter[id][_eq]=${session.karyawanId}&fields=kiosk_menu_access&limit=1`
			).catch(() => ({ data: [] })),
			// Fase 3D — id shift hari ini, dipakai kiosk/input-produksi untuk banner read-only
			// "Shift: ..." dan disimpan ke spk_daily_log.jadwal_kerja_id saat submit.
			resolveJadwalKerjaId(session.karyawanId, today),
			// Fase 3D — daftar lengkap jadwal kerja, hanya dipakai UI kalau operator menekan
			// "Bukan shift saya?" (override manual). Query terpisah, murah (koleksi kecil & statis).
			directusServerJson<{ data: any[] }>(
				`/items/jadwal_kerja?filter[jenis_hari][_eq]=Hari Kerja&fields=id,nama_jadwal,jam_masuk_normal,jam_keluar_normal&sort=nama_jadwal&limit=-1`
			).catch(() => ({ data: [] })),
			// Fase 4B — daftar mesin produksi untuk selector di kiosk/input-produksi. Reuse
			// `equipment` yang sudah ada & dipakai kiosk/lapor-mesin (bukan daftar baru).
			// TIDAK diturunkan dari master_workstation -- tidak ada relasi workstation->equipment
			// di skema live (koreksi rencana lama), jadi operator memilih sekali & tersimpan di
			// localStorage perangkat (lihat kiosk/input-produksi).
			directusServerJson<{ data: any[] }>(
				`/items/equipment?filter[parent_category][_eq]=PRODUKSI&fields=id,code,name&sort=name&limit=-1`
			).catch(() => ({ data: [] }))
		]);

	const kioskMenuAccess = Array.isArray(karyawanRes?.data?.[0]?.kiosk_menu_access)
		? karyawanRes.data[0].kiosk_menu_access
		: [];

	const jadwalOptions = jadwalOptionsRes?.data || [];
	const shiftDetail = jadwalKerjaIdResolved
		? jadwalOptions.find((j: any) => String(j.id) === String(jadwalKerjaIdResolved))
		: null;

	return json({
		karyawan: { id: session.karyawanId, nama: session.nama },
		announcements: announcementsRes?.data || [],
		spkBerjalanTotal: spkResult.berjalan,
		spkBelumMulaiTotal: spkResult.belumMulai,
		spkError: spkResult.error,
		timeoutMinutes: Number(timeoutMinutes) || 5,
		kioskMenuAccess,
		shift: {
			jadwalKerjaId: jadwalKerjaIdResolved,
			namaJadwal: shiftDetail?.nama_jadwal || null,
			jamMasuk: shiftDetail?.jam_masuk_normal || null,
			jamKeluar: shiftDetail?.jam_keluar_normal || null
		},
		jadwalKerjaOptions: jadwalOptions,
		equipmentOptions: equipmentOptionsRes?.data || []
	});
};
