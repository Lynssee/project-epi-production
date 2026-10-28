// src/routes/api/pusat-pengajuan/+server.ts
// Data untuk halaman Pusat Pengajuan: katalog kartu + badge jumlah menunggu.
// Dua query ke Directus (bukan satu per kartu) sesuai rencana §Fase2.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

// Peta koleksi spoke → kode jenis_pengajuan (sinkron dengan KODE_PREFIX di masterPengajuanSubmit.ts)
const COLLECTION_TO_JENIS: Record<string, string> = {
	kasbon: 'PJM',
	cuti_karyawan: 'CTI',
	ess_lembur: 'LMB',
	klaim_reimbursement: 'RMB',
	requisition: 'REQ',
	project_budgets: 'PKL'
};

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const [katalogRes, pendingRes, totalRes] = await Promise.all([
		// 1. Semua kartu aktif (diurut dari Directus)
		directusServerJson<any>(
			'/items/master_pengajuan_katalog?filter[aktif][_eq]=true&sort=urutan&limit=-1&fields=id,jenis_pengajuan,label,ikon,kategori,deskripsi_singkat,rute_form,rute_riwayat,permission_key,warna_kartu'
		),

		// 2. Jumlah approval_requests pending milik user ini, dikelompokkan per koleksi
		directusServerJson<any>(
			`/items/approval_requests?filter[requester_id][_eq]=${karyawan.id}&filter[status][_eq]=pending&aggregate[count]=id&groupBy[]=source_collection&limit=-1`
		),

		// 3. Total semua pengajuan di katalog milik user ini, dikelompokkan per jenis
		directusServerJson<any>(
			`/items/master_pengajuan?filter[pengaju_id][_eq]=${karyawan.id}&aggregate[count]=id&groupBy[]=jenis_pengajuan&limit=-1`
		)
	]);

	// Bangun map badge: jenis_pengajuan → { pending, total }
	const pendingByJenis: Record<string, number> = {};
	for (const row of pendingRes?.data || []) {
		const jenis = COLLECTION_TO_JENIS[row.source_collection];
		if (jenis) pendingByJenis[jenis] = parseInt(row.count?.id || 0, 10);
	}

	const totalByJenis: Record<string, number> = {};
	for (const row of totalRes?.data || []) {
		totalByJenis[row.jenis_pengajuan] = parseInt(row.count?.id || 0, 10);
	}

	// Fase 5 (Pertajam Pengajuan Pembelian v2, 23 Agu 2026): jumlah PR "berjalan" milik user
	// ini, per kategori_pembelian — dipakai badge pada kartu "Kategori Favorit". Dua langkah
	// (bukan groupBy lintas-koleksi, Directus tidak bisa): (1) id PR milik user dari
	// master_pengajuan (pengaju_id sudah terisi sejak Fase 0), (2) kategori+status_kanonik
	// PR itu, filter _in ke id dari langkah 1 saja — bukan tarik semua PR di sistem.
	const prByCategory: Record<string, number> = {};
	const myPrIdsRes = await directusServerJson<any>(
		`/items/master_pengajuan?filter[pengaju_id][_eq]=${karyawan.id}&filter[jenis_pengajuan][_eq]=PR&fields=detail_ref_id&limit=-1`
	);
	const myPrIds = (myPrIdsRes?.data || []).map((r: any) => r.detail_ref_id).filter(Boolean);
	if (myPrIds.length > 0) {
		const SELESAI_STATUSES = ['selesai', 'ditolak', 'dibatalkan'];
		const myPrRes = await directusServerJson<any>(
			`/items/pengajuan?filter[id][_in]=${myPrIds.join(',')}&fields=id,kategori_pembelian,status_kanonik&limit=-1`
		);
		for (const row of myPrRes?.data || []) {
			if (!row.kategori_pembelian) continue;
			if (SELESAI_STATUSES.includes(row.status_kanonik)) continue;
			prByCategory[row.kategori_pembelian] = (prByCategory[row.kategori_pembelian] || 0) + 1;
		}
	}

	// Pengajuan Darurat Atas Nama (Fase 3): PA/PR yang menunggu konfirmasi SAYA — ikut respons ini (hemat 1 round-trip).
	const STATUS_MENUNGGU = encodeURIComponent('Menunggu Konfirmasi Pemohon');
	const [paWait, prWait] = await Promise.all([
		directusServerJson<any>(
			`/items/pengajuan_anggaran?filter[pengaju_id][_eq]=${karyawan.id}&filter[status][_eq]=${STATUS_MENUNGGU}&filter[pemohon_status][_eq]=menunggu&fields=id,nomor_pengajuan,tujuan_pengajuan,total_amount&sort=-date_created&limit=20`
		).catch((e: any) => { console.warn('[pusat-pengajuan] gagal baca PA menunggu konfirmasi:', e?.message); return null; }),
		directusServerJson<any>(
			`/items/pengajuan?filter[pengaju_karyawan_id][_eq]=${karyawan.id}&filter[status][_eq]=${STATUS_MENUNGGU}&filter[pemohon_status][_eq]=menunggu&fields=id,tujuan_pengajuan&sort=-date_created&limit=20`
		).catch((e: any) => { console.warn('[pusat-pengajuan] gagal baca PR menunggu konfirmasi:', e?.message); return null; })
	]);
	const menungguKonfirmasi = [
		...(paWait?.data || []).map((r: any) => ({ jenis: 'anggaran', ...r })),
		...(prWait?.data || []).map((r: any) => ({ jenis: 'pr', ...r }))
	];

	// Fase 5 unifikasi (13 Okt 2026): PA milik SAYA yang tertahan gate (Pending + interlocking_status=blocked) —
	// satu query ringan (limit 5) ikut respons ini agar kartu panduan perbaikan tampil tanpa round-trip tambahan.
	// Hanya gate WAJIB yang gagal; pesan gate sudah berupa petunjuk. Gagal baca = daftar kosong + log (bukan error halaman).
	const tertahanRes = await directusServerJson<any>(
		`/items/pengajuan_anggaran?filter[pengaju_id][_eq]=${karyawan.id}&filter[status][_eq]=Pending&filter[interlocking_status][_eq]=blocked` +
			`&fields=id,nomor_pengajuan,tujuan_pengajuan,total_amount,interlocking_gates&sort=-date_created&limit=5`
	).catch((e: any) => { console.warn('[pusat-pengajuan] gagal baca PA tertahan gate:', e?.message); return null; });
	const tertahanGate = (tertahanRes?.data || []).map((r: any) => ({
		id: r.id,
		nomor: r.nomor_pengajuan || `PA #${r.id}`,
		tujuan: r.tujuan_pengajuan || '',
		failed: (Array.isArray(r.interlocking_gates) ? r.interlocking_gates : [])
			.filter((g: any) => g?.severity === 'WAJIB' && g?.status === 'failed')
			.map((g: any) => ({ gate_key: g.gate_key, label: g.label, message: g.message || '' }))
	}));

	return json({
		menungguKonfirmasi,
		tertahanGate,
		katalog: katalogRes?.data || [],
		karyawanId: karyawan.id,
		badges: {
			pending: pendingByJenis,
			total: totalByJenis,
			prByCategory
		}
	});
};
