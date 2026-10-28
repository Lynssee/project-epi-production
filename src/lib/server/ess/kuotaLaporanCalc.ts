// src/lib/server/ess/kuotaLaporanCalc.ts
// Fase 3 ESS (poin 3 & 4) "Pembaruan Kebijakan Absensi Leader dan Payroll" (Memo HRD
// 018/MEMO/HRD/VIII/2026) — versi self-view untuk Project Leader di ESS lapangan, pendamping
// kartu "Akumulasi Terlambat" yang tidak relevan bagi mereka (bebas denda jam masuk).
//
// Kuota 8 jam kerja: duplikasi KECIL & DISENGAJA dari hitungPelanggaranKuotaPerLeader() di
// erp-epi-1/src/lib/server/kuotaKerjaSanksiEngine.js (durasi kerja = rentang check-in pertama
// s.d. check-out terakhir dari absensi_harian + site_checkin, dikurangi istirahat — keputusan
// user 2026-09-17 untuk multi-site visit). Kepatuhan laporan: duplikasi kecil dari
// hitungPelanggaranPerLeader() di erp-epi-1/src/lib/server/laporanSanksiEngine.js, diperkecil
// scope-nya ke SATU leader (dipanggil dari sesi ESS-nya sendiri, bukan job batch semua leader).
// Kedua app terpisah (repo & deploy sendiri-sendiri), tidak ada package bersama — duplikasi kecil
// ini lebih aman daripada import lintas-repo. Kalau rumus di erp-epi-1 berubah, samakan di sini juga.

import { directusServerJson } from '$lib/server/directus';

const KUOTA_MENIT = 8 * 60;
const ACTIVE_PROJECT_STATUSES = ['active', 'in_progress', 'on progress', 'waiting', 'hold', 'pending', 'repair'];
const HADIR_LIKE = new Set(['HADIR', 'TERLAMBAT', 'SHIFT SIANG', 'SHIFT MALAM', 'TUGAS', 'DINAS LUAR', 'IZIN PULANG CEPAT', 'Stand-by']);

function timeStringToMinutes(str: string | null | undefined): number | null {
	if (!str || typeof str !== 'string' || str === '-') return null;
	const parts = str.split(':');
	if (parts.length < 2) return null;
	const h = Number(parts[0]);
	const m = Number(parts[1]);
	if (Number.isNaN(h) || Number.isNaN(m)) return null;
	return h * 60 + m;
}

function durasiIstirahatMenit(rec: { jam_istirahat_keluar?: string | null; jam_istirahat_masuk?: string | null }): number {
	const keluar = timeStringToMinutes(rec?.jam_istirahat_keluar);
	let masuk = timeStringToMinutes(rec?.jam_istirahat_masuk);
	if (keluar == null || masuk == null) return 0;
	if (masuk <= keluar) masuk += 1440; // lintas tengah malam
	return masuk - keluar;
}

export interface RincianHariKuota {
	tanggal: string;
	jamKerja: number;
}

export interface KuotaKerjaBulanIni {
	hariKurangKuota: number;
	rincianHari: RincianHariKuota[];
	hariDievaluasi: number;
}

/**
 * @param karyawanId id karyawan (Leader yang sedang login di ESS)
 * @param periode 'YYYY-MM'
 */
export async function hitungKuotaKerjaBulanIni(karyawanId: number, periode: string): Promise<KuotaKerjaBulanIni> {
	const startDate = `${periode}-01`;
	const [y, m] = periode.split('-').map(Number);
	const endExclusive = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);

	const absensiRes = await directusServerJson<{ data: any[] }>(
		`/items/absensi_harian?filter[karyawan_id][_eq]=${karyawanId}` +
			`&filter[tanggal][_gte]=${startDate}&filter[tanggal][_lt]=${endExclusive}` +
			`&fields=tanggal,status,jam_masuk,jam_keluar,jam_istirahat_keluar,jam_istirahat_masuk&limit=-1`
	);
	const absensiList = absensiRes?.data || [];

	const checkinRes = await directusServerJson<{ data: any[] }>(
		`/items/site_checkin?filter[karyawan_id][_eq]=${karyawanId}` +
			`&filter[check_in_at][_gte]=${startDate}T00:00:00&filter[check_in_at][_lt]=${endExclusive}T00:00:00` +
			`&filter[status][_neq]=canceled&fields=check_in_at,check_out_at&limit=-1`
	);
	const checkinByDay = new Map<string, { checkIn: string | null; checkOut: string | null }[]>();
	for (const c of checkinRes?.data || []) {
		const day = String(c.check_in_at || '').slice(0, 10);
		if (!day) continue;
		if (!checkinByDay.has(day)) checkinByDay.set(day, []);
		checkinByDay.get(day)!.push({
			checkIn: c.check_in_at ? c.check_in_at.slice(11, 16) : null,
			checkOut: c.check_out_at ? c.check_out_at.slice(11, 16) : null
		});
	}

	let hariKurangKuota = 0;
	let hariDievaluasi = 0;
	const rincianHari: RincianHariKuota[] = [];

	for (const rec of absensiList) {
		const status = String(rec.status || '').toUpperCase();
		if (!HADIR_LIKE.has(status) && status !== 'HADIR') continue;
		if (!rec.jam_keluar || rec.jam_keluar === '-') continue; // belum absen pulang -> jangan tebak

		const day = String(rec.tanggal || '').slice(0, 10);
		const times: number[] = [];
		const push = (t: string | null | undefined) => {
			const mm = timeStringToMinutes(t);
			if (mm !== null) times.push(mm);
		};
		push(rec.jam_masuk);
		push(rec.jam_keluar);
		for (const v of checkinByDay.get(day) || []) {
			push(v.checkIn);
			push(v.checkOut);
		}
		if (times.length < 2) continue;

		hariDievaluasi++;
		const rentangMenit = Math.max(...times) - Math.min(...times);
		const menitKerja = Math.max(0, rentangMenit - durasiIstirahatMenit(rec));
		if (menitKerja < KUOTA_MENIT) {
			hariKurangKuota++;
			rincianHari.push({ tanggal: day, jamKerja: Math.round((menitKerja / 60) * 10) / 10 });
		}
	}

	return { hariKurangKuota, rincianHari, hariDievaluasi };
}

export interface KepatuhanLaporanBulanIni {
	sudahLaporHariIni: boolean;
	wajibLaporHariIni: boolean;
	hariBolongBulanIni: number;
	batasJam: string;
}

/**
 * @param karyawanId id karyawan (Leader) — dicocokkan ke projects.leader_id
 * @param periode 'YYYY-MM'
 */
export async function hitungKepatuhanLaporanBulanIni(karyawanId: number, periode: string): Promise<KepatuhanLaporanBulanIni> {
	const ruleRes = await directusServerJson<{ data: any }>('/items/laporan_compliance_rule/1').catch(() => null);
	const rule = ruleRes?.data || { hari_wajib: [1, 2, 3, 4, 5, 6], batas_jam: '22:00' };

	const startDate = `${periode}-01`;
	const [y, m] = periode.split('-').map(Number);
	const endExclusive = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
	const todayStr = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
	const todayDow = new Date(`${todayStr}T00:00:00Z`).getUTCDay();
	const wajibLaporHariIni = Array.isArray(rule.hari_wajib) && rule.hari_wajib.includes(todayDow);

	const filter = encodeURIComponent(
		JSON.stringify({ _and: [{ leader_id: { _eq: karyawanId } }, { status: { _in: ACTIVE_PROJECT_STATUSES } }] })
	);
	const projectsRes = await directusServerJson<{ data: any[] }>(`/items/projects?filter=${filter}&fields=id&limit=-1`);
	const projectIds: string[] = (projectsRes?.data || []).map((p) => String(p.id));
	if (projectIds.length === 0) {
		return { sudahLaporHariIni: false, wajibLaporHariIni: false, hariBolongBulanIni: 0, batasJam: rule.batas_jam };
	}

	const gte = encodeURIComponent(`${startDate}T00:00:00+07:00`);
	const lt = encodeURIComponent(`${endExclusive}T00:00:00+07:00`);
	const reportsRes = await directusServerJson<{ data: any[] }>(
		`/items/reports?filter[project_id][_in]=${projectIds.join(',')}&filter[date][_gte]=${gte}&filter[date][_lt]=${lt}&fields=project_id,date&limit=-1`
	);
	const reportDays = new Set<string>();
	for (const r of reportsRes?.data || []) {
		const pid = typeof r.project_id === 'object' ? r.project_id?.id : r.project_id;
		const day = String(r.date || '').slice(0, 10);
		if (pid && day) reportDays.add(`${pid}_${day}`);
	}

	// Hari INI sengaja tidak dihitung "bolong" di sini walau belum lapor — batas submit masih
	// sampai batas_jam (22:00 WIB), status hari ini murni dari sudahLaporHariIni di bawah supaya
	// tidak memberi alarm palsu "sudah bolong" padahal jam belum lewat batas (anti-cemas, Memo 018).
	let hariBolongBulanIni = 0;
	const cursor = new Date(`${startDate}T00:00:00Z`);
	while (cursor.toISOString().slice(0, 10) < endExclusive && cursor.toISOString().slice(0, 10) < todayStr) {
		const ds = cursor.toISOString().slice(0, 10);
		if (Array.isArray(rule.hari_wajib) && rule.hari_wajib.includes(cursor.getUTCDay())) {
			const adaLaporan = projectIds.some((pid) => reportDays.has(`${pid}_${ds}`));
			if (!adaLaporan) hariBolongBulanIni++;
		}
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}

	const sudahLaporHariIni = projectIds.some((pid) => reportDays.has(`${pid}_${todayStr}`));

	return { sudahLaporHariIni, wajibLaporHariIni, hariBolongBulanIni, batasJam: rule.batas_jam };
}
