// src/routes/api/ess/keuangan/summary/+server.ts
// FITUR-5 (Personal Finance Dashboard Karyawan): riwayat gaji 12 bulan, proyeksi THR,
// status cicilan kasbon, dan estimasi take-home bulan berjalan. Read-only.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { decryptPayrollList } from '$lib/server/ess/payrollDecrypt';
import { listKasbonByKaryawan, getKonfigurasiKasbon, computeJadwalAngsuran } from '$lib/server/ess/kasbon';
import { todayJakarta } from '$lib/server/ess/time';

interface KaryawanFields {
	gaji_pokok: number | null;
	tunjangan_jabatan: number | null;
	tunjangan_makan: number | null;
	tunjangan_transport: number | null;
	tanggal_masuk: string | null;
}

// Porting hitungMasaKerjaBulanUntukTHR + calculateTHRGrossForEmployee (gross saja, belum PPh21
// atas THR) dari erp-epi-1/src/lib/services/payrollSync.js — dua repo terpisah, tidak bisa
// import langsung, jadi logiknya direplikasi persis (PP 36/2021, Permenaker 6/2016).
function hitungMasaKerjaBulan(tanggalMasuk: string | null, tanggalRef: string): number {
	if (!tanggalMasuk) return 0;
	const masuk = new Date(`${tanggalMasuk}T00:00:00`);
	const ref = new Date(`${tanggalRef}T00:00:00`);
	if (Number.isNaN(masuk.getTime()) || Number.isNaN(ref.getTime()) || ref < masuk) return 0;
	let bulan = (ref.getFullYear() - masuk.getFullYear()) * 12 + (ref.getMonth() - masuk.getMonth());
	if (ref.getDate() < masuk.getDate()) bulan -= 1;
	return Math.max(0, bulan);
}

function estimasiThr(k: KaryawanFields, tanggalRef: string) {
	const gajiPokok = Number(k.gaji_pokok) || 0;
	const tunjanganTetap =
		(Number(k.tunjangan_jabatan) || 0) + (Number(k.tunjangan_makan) || 0) +
		(Number(k.tunjangan_transport) || 0);
	const masaKerjaBulan = hitungMasaKerjaBulan(k.tanggal_masuk, tanggalRef);
	const dasarThr = gajiPokok + tunjanganTetap;
	let nominalThr = 0;
	if (masaKerjaBulan >= 12) nominalThr = dasarThr;
	else if (masaKerjaBulan >= 1) nominalThr = Math.round((dasarThr * masaKerjaBulan) / 12);
	return { masaKerjaBulan, nominalThr };
}

function calcLemburHours(jamMulai: string, jamSelesai: string): number {
	const [mH, mM] = jamMulai.split(':').map(Number);
	const [sH, sM] = jamSelesai.split(':').map(Number);
	let menit = sH * 60 + sM - (mH * 60 + mM);
	if (menit <= 0) menit += 1440;
	return menit / 60;
}

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const tanggalRef = todayJakarta();
	const periodeBerjalan = tanggalRef.slice(0, 7);

	const [payrollRes, karyawanRes, kasbonRiwayat, konfigKasbon, lemburRes] = await Promise.all([
		directusServerJson<{ data: any[] }>(
			`/items/payroll_bulanan?filter[karyawan_id][_eq]=${karyawan.id}&filter[status][_in]=Disetujui,Dibayar&sort=-periode&limit=12&fields=periode,gaji_bersih,gaji_pokok,potongan_bpjs_kesehatan,potongan_bpjs_ketenagakerjaan,potongan_pph21,payload_terenkripsi`
		),
		directusServerJson<{ data: KaryawanFields }>(
			`/items/karyawan/${karyawan.id}?fields=gaji_pokok,tunjangan_jabatan,tunjangan_makan,tunjangan_transport,tanggal_masuk`
		),
		listKasbonByKaryawan(karyawan.id),
		getKonfigurasiKasbon(),
		directusServerJson<{ data: Array<{ jam_mulai: string; jam_selesai: string }> }>(
			`/items/ess_lembur?filter[karyawan_id][_eq]=${karyawan.id}&filter[status][_eq]=Disetujui&filter[tanggal][_gte]=${periodeBerjalan}-01&limit=-1&fields=jam_mulai,jam_selesai`
		)
	]);

	const riwayatGaji = (await decryptPayrollList(payrollRes?.data || []))
		.map(({ payload_terenkripsi, ...rest }) => rest)
		.reverse(); // urut lama -> baru untuk grafik

	const k = karyawanRes?.data;
	const thr = k ? estimasiThr(k, tanggalRef) : { masaKerjaBulan: 0, nominalThr: 0 };

	// Status kasbon — sama seperti /api/ess/kasbon/status tapi ringkas (tanpa riwayat pembayaran detail).
	const gajiPokok = Number(k?.gaji_pokok) || 0;
	const plafon = Math.round(gajiPokok * konfigKasbon.plafonMultiplier);
	const aktif = (kasbonRiwayat || []).filter(
		(row) => ['Diajukan', 'Disetujui Atasan', 'Disetujui HRD', 'approved'].includes(row.status) && row.payment_status !== 'lunas'
	);
	const sisaKasbon = aktif.reduce((sum, row) => sum + (Number(row.nominal) - Number(row.total_paid || 0)), 0);
	const cicilanBulanIni = aktif
		.filter((row) => row.status === 'approved')
		.reduce((sum, row) => {
			const jadwal = computeJadwalAngsuran(row);
			const barisBulanIni = jadwal.find((j: any) => j.periode === periodeBerjalan);
			return sum + (barisBulanIni ? Number(barisBulanIni.nominal_rencana) || 0 : 0);
		}, 0);

	// Estimasi take-home bulan berjalan — MVP kasar: gaji pokok+tunjangan tetap (karyawan) + lembur
	// disetujui bulan ini, dikurangi rata-rata potongan BPJS+PPh21 3 slip terakhir (proxy, karena
	// besarannya relatif stabil bulan-ke-bulan) dan cicilan kasbon bulan ini. BUKAN angka final —
	// slip resmi tetap dari HRD setelah periode tutup.
	const tunjanganTetap =
		(Number(k?.tunjangan_jabatan) || 0) + (Number(k?.tunjangan_makan) || 0) +
		(Number(k?.tunjangan_transport) || 0) + (Number(k?.tunjangan_lainnya) || 0);
	const last3 = riwayatGaji.slice(-3);
	const avgBpjsPph21 = last3.length > 0
		? last3.reduce((s, r) => s + (Number(r.potongan_bpjs_kesehatan) || 0) + (Number(r.potongan_bpjs_ketenagakerjaan) || 0) + (Number(r.potongan_pph21) || 0), 0) / last3.length
		: 0;
	const lemburJamBerjalan = (lemburRes?.data || []).reduce((s, l) => s + calcLemburHours(l.jam_mulai, l.jam_selesai), 0);
	const rateJam = gajiPokok / 8 / 25; // estimasi kasar tarif/jam dari gaji pokok (25 hari kerja/bulan)
	const estimasiLembur = Math.round(lemburJamBerjalan * rateJam * 1.5);
	const estimasiTakeHomeBerjalan = Math.max(
		0,
		Math.round(gajiPokok + tunjanganTetap + estimasiLembur - avgBpjsPph21 - cicilanBulanIni)
	);

	// F6.4 — "Tanggungan Saya": kewajiban lintas kanal supaya user tahu apa yang harus
	// dibereskan sebelum pengajuan baru bisa lolos gate. Read-only, gagal-lunak (fetch
	// yang error dianggap kosong — jangan sampai menggagalkan halaman keuangan).
	const emailKar = (karyawan as any).email_company || (karyawan as any).email || '';
	const [klaimRes, spjRes] = await Promise.all([
		directusServerJson<{ data: any[] }>(
			`/items/klaim_reimbursement?filter[karyawan_id][_eq]=${karyawan.id}` +
			`&filter[status][_in]=Diajukan,Disetujui Atasan,Disetujui HRD,approved&fields=id,jumlah,status,tanggal_pengajuan&limit=-1`
		).catch(() => ({ data: [] })),
		emailKar
			? directusServerJson<{ data: any[] }>(
				`/items/pengajuan_anggaran?filter[created_by_email][_eq]=${encodeURIComponent(emailKar)}` +
				`&filter[status][_in]=Completed,Selesai,Dibukukan&filter[tanggal_dicairkan][_nnull]=true` +
				`&filter[kategori][_in]=operasional,contingency` +
				`&fields=id,nomor_pengajuan,total_amount,tanggal_dicairkan,status_pertanggungjawaban&limit=-1`
			).catch(() => ({ data: [] }))
			: Promise.resolve({ data: [] })
	]);

	const klaimList = klaimRes?.data || [];
	const klaimMenunggu = { jumlah: klaimList.length, nominal: klaimList.reduce((s, r) => s + (Number(r.jumlah) || 0), 0) };

	const SPJ_DONE = ['selesai', 'diverifikasi'];
	const nowMs = Date.now();
	const spjMenunggak = (spjRes?.data || [])
		.filter((p) => !SPJ_DONE.includes(String(p.status_pertanggungjawaban || '').toLowerCase()))
		.map((p) => ({
			nomor: p.nomor_pengajuan || `#${p.id}`,
			nominal: Number(p.total_amount) || 0,
			hariSejakCair: Math.floor((nowMs - new Date(p.tanggal_dicairkan).getTime()) / 86400000)
		}))
		.sort((a, b) => b.hariSejakCair - a.hariSejakCair);
	const spjRingkas = {
		jumlah: spjMenunggak.length,
		nominal: spjMenunggak.reduce((s, r) => s + r.nominal, 0),
		terlamaHari: spjMenunggak[0]?.hariSejakCair ?? 0,
		daftar: spjMenunggak.slice(0, 5)
	};

	return json({
		riwayatGaji,
		thr,
		kasbon: { plafon, sisaKasbon, cicilanBulanIni, jumlahAktif: aktif.length },
		estimasiTakeHomeBerjalan,
		periodeBerjalan,
		tanggungan: {
			kasbon: { jumlah: aktif.length, nominal: sisaKasbon },
			klaimMenunggu,
			spj: spjRingkas
		}
	});
};
