// src/routes/api/ess/attendance/disiplin-status/+server.ts
// Fase 3 ESS — Status Kehadiran & Denda Real-time. Read-only, tidak menulis apapun.
// Hanya menampilkan angka nyata bila konfigurasi_kebijakan_disiplin tahun ini berstatus 'aktif'
// (sama seperti gate Fase 1 di erp-epi-1) — kalau masih 'draft', frontend menampilkan pesan netral.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';
import { loadIstirahatConfig, getKaryawanJadwalDisiplin } from '$lib/server/ess/istirahat';
import { hitungStatusKehadiranBulanIni, type KonfigurasiDisiplin, type AbsensiRecord } from '$lib/server/ess/disiplinCalc';
import { isLeaderKaryawan } from '$lib/utils/isLeaderKaryawan';
import { hitungKuotaKerjaBulanIni, hitungKepatuhanLaporanBulanIni } from '$lib/server/ess/kuotaLaporanCalc';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const { konfig: rawKonfig } = await loadIstirahatConfig();
	const konfig = rawKonfig as KonfigurasiDisiplin | null;

	if (!konfig || konfig.status !== 'aktif') {
		return json({ aktif: false });
	}

	const bulanIni = todayJakarta().slice(0, 7); // YYYY-MM
	const [year, month] = bulanIni.split('-');
	const start = `${year}-${month}-01`;
	const lastDay = new Date(Number(year), Number(month), 0).getDate();
	const end = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

	const absensiQuery = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawan.id),
		'filter[tanggal][_gte]': start,
		'filter[tanggal][_lte]': end,
		fields: 'tanggal,status,jam_masuk',
		limit: '-1'
	});

	const [{ polaKerja, jadwal }, absensiRes] = await Promise.all([
		getKaryawanJadwalDisiplin(karyawan.id),
		directusServerJson<{ data: AbsensiRecord[] }>(`/items/absensi_harian?${absensiQuery.toString()}`)
	]);

	// Memo HRD 018/MEMO/HRD/VIII/2026: Leader/Coordinator bebas denda jam masuk — kartu "Akumulasi
	// Terlambat" tidak relevan bagi mereka, diganti "Kepatuhan Kuota 8 Jam & Laporan ERP" di frontend.
	const isLeader = isLeaderKaryawan({ pola_kerja: polaKerja, posisi: karyawan.posisi });
	const absensiList = absensiRes?.data || [];

	const status = hitungStatusKehadiranBulanIni(absensiList, jadwal, konfig);

	if (!isLeader) {
		return json({ aktif: true, periode: bulanIni, isLeader: false, ...status });
	}

	// Leader: TIDAK ADA denda telat/pulang cepat sama sekali (Memo 018 poin 2 & keputusan pak Vio
	// 7 Sep 2026, sudah ditegakkan di payrollCalcCore.js/disiplinPayrollEngine.js erp-epi-1) — nolkan
	// di sini juga supaya ESS tidak menampilkan estimasi denda/hitungan telat yang menyesatkan
	// (angka yang pada akhirnya TIDAK akan pernah benar-benar memotong gaji). Kepatuhan diganti
	// kuota 8 jam kerja & laporan harian (poin 1,3,4).
	const [kuota, laporan] = await Promise.all([
		hitungKuotaKerjaBulanIni(karyawan.id, bulanIni).catch(() => null),
		hitungKepatuhanLaporanBulanIni(karyawan.id, bulanIni).catch(() => null)
	]);

	return json({
		aktif: true,
		periode: bulanIni,
		isLeader: true,
		...status,
		hariTerlambat: 0,
		estimasiDendaTerlambat: 0,
		maxMenitTelat: 0,
		posisiSaatIni: 'aman',
		rincianTelat: [],
		kuotaKerja: kuota,
		kepatuhanLaporan: laporan
	});
};
