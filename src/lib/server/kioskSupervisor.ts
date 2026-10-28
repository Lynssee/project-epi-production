// src/lib/server/kioskSupervisor.ts
// Resolusi penerima notifikasi supervisor produksi — diekstrak dari
// api/kiosk/supervisor-call/+server.ts (Fase 2D, 12 Sep 2026) supaya dipakai bersama oleh
// "Panggil Supervisor" DAN endpoint baru "Minta Mulai Produksi" (file 03, §3.4). JANGAN
// disalin ulang per endpoint — satu sumber kebenaran untuk siapa yang dihubungi.
//
//   1. shift_roster hari ini (WIB) -> karyawan_id yang sedang bertugas (status 'aktif').
//   2. Saring ke karyawan berperan supervisor produksi: divisi mengandung "produksi" DAN
//      jabatan_id.grade = 'Supervisor'. Dua query TERPISAH (Aturan #2 — jangan relasi
//      bersarang), lalu diirisankan di sini.
//   3. Bila irisan kosong -> fallback ke system_settings kiosk.supervisor_fallback_karyawan_ids
//      (Aturan #4 — validasi/penentuan penerima wajib fallback).

import { directusServerJson } from '$lib/server/directus';
import { todayWib } from '$lib/utils/wibDate';

export async function readJsonSetting<T>(key: string, fallback: T): Promise<T> {
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

/** Query 1 — siapa yang bertugas hari ini (WIB), lepas dari perannya. */
async function karyawanIdsBertugasHariIni(): Promise<number[]> {
	const today = todayWib();
	const res = await directusServerJson<{ data: any[] }>(
		`/items/shift_roster?filter[tanggal][_eq]=${today}&filter[status][_eq]=aktif&fields=karyawan_id&limit=-1`
	).catch(() => ({ data: [] }));
	return (res?.data || [])
		.map((r) => (typeof r.karyawan_id === 'object' ? r.karyawan_id?.id : r.karyawan_id))
		.filter((id): id is number => Number.isFinite(id));
}

/** Query 2 — siapa saja supervisor produksi aktif (lepas dari jadwal), query terpisah dari (1)
 *  supaya tidak perlu relasi bersarang saat mengiris keduanya.
 *
 *  File 10 §2.4 — sebelumnya `filter[jabatan_id][grade][_eq]=Supervisor` (relasi bersarang,
 *  Aturan #2 dilanggar). Dipecah: (a) cari id `posisi` bergrade Supervisor lebih dulu — bukan
 *  `jabatan` (koleksi itu tidak ada di skema live; relasi karyawan.jabatan_id sebenarnya
 *  menunjuk ke `posisi`, diverifikasi lewat skema live) — lalu (b) filter karyawan dengan
 *  jabatan_id di antara id itu. Juga disamakan dengan file 01: status_kerja (bukan status)
 *  untuk cek karyawan aktif. */
async function supervisorProduksiIds(): Promise<number[]> {
	const posisiRes = await directusServerJson<{ data: any[] }>(
		`/items/posisi?filter[grade][_eq]=Supervisor&fields=id&limit=-1`
	).catch(() => ({ data: [] }));
	const posisiIds = (posisiRes?.data || []).map((p) => p.id).filter((id): id is number => Number.isFinite(id));
	if (posisiIds.length === 0) return [];

	const res = await directusServerJson<{ data: any[] }>(
		`/items/karyawan?filter[status_kerja][_neq]=${encodeURIComponent('Tidak Aktif')}&filter[divisi][_icontains]=produksi` +
			`&filter[jabatan_id][_in]=${posisiIds.join(',')}&fields=id&limit=-1`
	).catch(() => ({ data: [] }));
	return (res?.data || []).map((r) => r.id).filter((id): id is number => Number.isFinite(id));
}

export interface SupervisorPenerima {
	waKaryawanIds: number[];
	usedFallback: boolean;
}

/** Irisan roster hari ini ∩ supervisor produksi, dengan fallback ke setelan admin bila kosong.
 *  Melempar tidak pernah — pemanggil yang menentukan apa yang terjadi kalau hasilnya kosong. */
export async function resolveSupervisorPenerima(): Promise<SupervisorPenerima> {
	const [bertugas, supervisor, fallbackIds] = await Promise.all([
		karyawanIdsBertugasHariIni(),
		supervisorProduksiIds(),
		readJsonSetting<number[]>('kiosk.supervisor_fallback_karyawan_ids', [])
	]);

	const supervisorSet = new Set(supervisor);
	let waKaryawanIds = bertugas.filter((id) => supervisorSet.has(id));

	let usedFallback = false;
	if (waKaryawanIds.length === 0 && Array.isArray(fallbackIds) && fallbackIds.length > 0) {
		waKaryawanIds = fallbackIds;
		usedFallback = true;
	}

	return { waKaryawanIds, usedFallback };
}
