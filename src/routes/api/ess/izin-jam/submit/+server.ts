// src/routes/api/ess/izin-jam/submit/+server.ts
// ESS HRD v3 Fase 2 — pengajuan izin per-jam (Izin Dinas/Pribadi/Cuti Jam-Jaman/Darurat).
// Kategori berasal dari cuti_kategori (Keputusan #4: perluas kerangka existing, bukan
// koleksi paralel). Approval lewat Universal Approval Engine (createApprovalRequest,
// pola sama requisitionSubmit.ts/kasbon.ts) — bukan mirror legacy, karena ini alur baru
// yang approval-nya SELURUHNYA di-drive oleh engine (callback menentukan QR pass).

import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';
import { verifyFace } from '$lib/server/ess/faceVerify';
import { createApprovalRequest } from '$lib/server/approvalSubmit';

// decideApprovalRequest() (erp-epi-1) memanggil fetch(callback_url) polos dari server —
// harus absolute URL. erp-epi-1 live di internal.eltamaprimaindo.com (pola sama
// requisitionSubmit.ts).
const ERP_EPI_1_ORIGIN = env.ERP_EPI1_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://internal.eltamaprimaindo.com' : 'http://localhost:9390');

interface CutiKategori {
	id: number;
	kode: string;
	nama: string;
	tipe: string;
	aktif: boolean;
	maks_durasi_jam: number | null;
	kuota_jam_per_bulan: number | null;
}

async function getKategori(kategoriId: number): Promise<CutiKategori | null> {
	try {
		const result = await directusServerJson<{ data: CutiKategori }>(
			`/items/cuti_kategori/${kategoriId}?fields=id,kode,nama,tipe,aktif,maks_durasi_jam,kuota_jam_per_bulan`
		);
		return result?.data || null;
	} catch {
		return null;
	}
}

async function sumJamBulanIni(karyawanId: number, kategoriId: number): Promise<number> {
	const now = new Date();
	const bulanAwal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		'filter[kategori_id][_eq]': String(kategoriId),
		'filter[tanggal][_gte]': bulanAwal,
		'filter[status][_nin]': 'ditolak,kedaluwarsa',
		fields: 'estimasi_durasi_jam',
		limit: '-1'
	});
	const result = await directusServerJson<{ data: { estimasi_durasi_jam: number }[] }>(
		`/items/izin_jam_request?${query.toString()}`
	);
	return (result?.data || []).reduce((sum, r) => sum + (Number(r.estimasi_durasi_jam) || 0), 0);
}

/**
 * Sisa cuti tahunan — versi ringkas untuk gate cuti_jam (bukan replikasi penuh
 * getSisaCuti di hrdCutiApi.js yang punya prorata+carry-over+cuti-bersama; itu
 * admin-only/erp-epi-1-only. Cukup akurat untuk gate submit, keputusan akhir tetap
 * di tangan atasan/HRD saat approval.
 */
async function estimasiSisaCutiTahunan(karyawanId: number): Promise<number> {
	const tahun = new Date().getFullYear();
	const [kategoriRes, karyawanRes, terpakaiRes, izinJamRes] = await Promise.all([
		directusServerJson<{ data: { kuota_hari: number }[] }>(
			`/items/cuti_kategori?filter[kelompok][_eq]=tahunan&limit=1&fields=kuota_hari`
		),
		directusServerJson<{ data: { tanggal_masuk: string } }>(`/items/karyawan/${karyawanId}?fields=tanggal_masuk`),
		directusServerJson<{ data: { jumlah_hari: number }[] }>(
			`/items/cuti_karyawan?filter[karyawan_id][_eq]=${karyawanId}&filter[status][_eq]=Disetujui&filter[jenis_cuti][_eq]=Cuti Tahunan&filter[tanggal_mulai][_gte]=${tahun}-01-01&fields=jumlah_hari&limit=-1`
		),
		directusServerJson<{ data: { estimasi_durasi_jam: number }[] }>(
			`/items/izin_jam_request?filter[karyawan_id][_eq]=${karyawanId}&filter[kategori_id.kode][_eq]=cuti_jam&filter[status][_nin]=ditolak,kedaluwarsa&filter[tanggal][_gte]=${tahun}-01-01&fields=estimasi_durasi_jam&limit=-1`
		)
	]);

	const hakTahunan = Number(kategoriRes?.data?.[0]?.kuota_hari) || 12;
	const terpakaiHari = (terpakaiRes?.data || []).reduce((s, c) => s + (Number(c.jumlah_hari) || 0), 0);
	const terpakaiJamKeCutiJam = (izinJamRes?.data || []).reduce((s, r) => s + (Number(r.estimasi_durasi_jam) || 0), 0);
	// Konversi kasar: tiap kejadian cuti_jam memotong 0.5 hari (sesuai kebijakan dokumen),
	// bukan proporsional jam — jadi dihitung per baris, bukan dari total jam.
	const kejadianCutiJam = (izinJamRes?.data || []).length;
	return hakTahunan - terpakaiHari - kejadianCutiJam * 0.5;
}

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const form = await event.request.formData();
	const kategoriId = Number(form.get('kategori_id'));
	const alasan = String(form.get('alasan') || '').trim();
	const estimasiDurasiJam = Number(form.get('estimasi_durasi_jam'));
	const foto = form.get('foto');
	const livenessPassed = form.get('liveness_passed') === 'true' || form.get('liveness_passed') === '1';
	const delegasiKaryawanId = form.get('delegasi_karyawan_id')?.toString().trim() || '';
	const delegasiCatatan = form.get('delegasi_catatan')?.toString().trim() || '';

	if (!Number.isFinite(kategoriId) || kategoriId <= 0) {
		throw error(400, 'Kategori izin wajib dipilih.');
	}
	if (!alasan) {
		throw error(400, 'Alasan wajib diisi.');
	}
	if (!Number.isFinite(estimasiDurasiJam) || estimasiDurasiJam <= 0) {
		throw error(400, 'Estimasi durasi wajib diisi (jam).');
	}
	if (!delegasiKaryawanId) {
		throw error(400, 'Pilih rekan kerja yang menerima delegasi tugas selama Anda izin.');
	}
	if (String(delegasiKaryawanId) === String(karyawan.id)) {
		throw error(400, 'Delegasi tugas tidak boleh diisi dengan diri sendiri.');
	}
	if (!delegasiCatatan || delegasiCatatan.length < 5) {
		throw error(400, 'Jelaskan tugas/tanggung jawab yang didelegasikan (wajib diisi).');
	}

	const kategori = await getKategori(kategoriId);
	if (!kategori || kategori.tipe !== 'Izin' || !kategori.aktif) {
		throw error(400, 'Kategori izin tidak valid atau tidak aktif.');
	}
	if (kategori.maks_durasi_jam != null && estimasiDurasiJam > kategori.maks_durasi_jam) {
		throw error(400, `Durasi melebihi maksimum ${kategori.maks_durasi_jam} jam untuk kategori ini.`);
	}

	if (kategori.kuota_jam_per_bulan != null) {
		const sudahDipakai = await sumJamBulanIni(karyawan.id, kategoriId);
		if (sudahDipakai + estimasiDurasiJam > kategori.kuota_jam_per_bulan) {
			throw error(
				400,
				`Kuota bulanan kategori ini ${kategori.kuota_jam_per_bulan} jam, sudah terpakai ${sudahDipakai} jam.`
			);
		}
	}

	if (kategori.kode === 'cuti_jam') {
		const sisa = await estimasiSisaCutiTahunan(karyawan.id);
		if (sisa < 0.5) {
			throw error(400, 'Sisa cuti tahunan tidak cukup untuk Cuti Jam-Jaman (minimal 0.5 hari).');
		}
	}

	let faceVerifyId: string | null = null;
	if (foto instanceof File && foto.size > 0) {
		const faceResult = await verifyFace({
			karyawanId: karyawan.id,
			foto,
			context: 'izin',
			livenessPassed,
			ipAddress: event.getClientAddress(),
			deviceInfo: event.request.headers.get('user-agent') || ''
		});
		faceVerifyId = faceResult.verificationId;
	}

	const tanggal = todayJakarta();
	const created = await directusServerJson<{ data: { id: string } }>('/items/izin_jam_request', {
		method: 'POST',
		body: JSON.stringify({
			karyawan_id: String(karyawan.id),
			kategori_id: kategoriId,
			tanggal,
			alasan,
			estimasi_durasi_jam: estimasiDurasiJam,
			status: 'menunggu_approval',
			face_verify_id: faceVerifyId,
			delegasi_karyawan_id: delegasiKaryawanId,
			delegasi_catatan: delegasiCatatan
		})
	});
	const izinJamId = created?.data?.id;
	if (!izinJamId) throw error(502, 'Gagal membuat pengajuan izin.');

	const approvalRequest = await createApprovalRequest({
		moduleKey: 'izin_jam',
		sourceCollection: 'izin_jam_request',
		sourceId: izinJamId,
		title: `Izin Jam-Jaman: ${kategori.nama}`,
		summary: alasan,
		departmentKey: karyawan.divisi || undefined,
		requesterId: karyawan.id,
		callbackUrl: `${ERP_EPI_1_ORIGIN}/api/izin-jam/approval-callback`,
		payload: { kategoriKode: kategori.kode, estimasiDurasiJam }
	});

	if (approvalRequest?.id) {
		await directusServerJson(`/items/izin_jam_request/${izinJamId}`, {
			method: 'PATCH',
			body: JSON.stringify({ approval_request_id: approvalRequest.id })
		});
	}

	return json({ id: izinJamId, status: 'menunggu_approval' });
};
