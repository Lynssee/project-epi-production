// src/routes/api/ess/attendance/izin-sakit/+server.ts
// Fase 3 ESS — Pengajuan Izin/Sakit (Kebijakan Kedisiplinan Karyawan, ref Memo 001/MEMO/HRD/I/2026).
// Selalu untuk HARI INI (tanggal dihitung di server, bukan dari klien) — "diinfokan sebelum jam
// kerja". Rentang lebih dari MAX_SAKIT_RANGE_HARI hari tetap pakai jalur "Cuti Sakit" yang sudah
// ada (cuti_karyawan) — hanya sakit singkat (Manajemen Sakit HRD) yang lewat endpoint ini.
//
// PENTING: status SAKIT hasil pengajuan ini SELALU 'SAKIT BELUM SURAT DOKTER (IZIN)' — bukan
// 'SAKIT' langsung — walau foto surat sudah diunggah. HRD wajib memverifikasi keabsahan surat di
// Admin (HrdAbsensi > Manajemen Sakit) sebelum menaikkan ke 'SAKIT' (yang baru mengecualikan dari
// potongan payroll, Pasal S-3). Ini mencegah karyawan meloloskan diri dari potongan hanya dengan
// mencentang status. Kalau surat tidak pernah diverifikasi dalam 2 hari, cron
// (disiplin-harian?type=surat_dokter_auto_alpa di erp-epi-1) otomatis menurunkan status ke ALPA.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { findTodayRecord, isEmptyTime } from '$lib/server/ess/absensi';
import { todayJakarta } from '$lib/server/ess/time';
import { mirrorSubmitApprovalRequest } from '$lib/server/approvalMirror';
import { susunPayloadDurasi, SESI } from '$lib/utils/absensiDurasi.js';

// Lapisan normalisasi durasi (selaras erp-epi). Menghasilkan kolom turunan absensi_harian
// (tipe_durasi, sesi, jam_mulai_izin, jam_selesai_izin, total_durasi_jam, potongan_hari) tanpa
// mengubah string `status` legacy yang tetap jadi sumber kebenaran untuk payroll/disiplin.
function kolomDurasi(
	jenis: string,
	statusLegacy: string,
	sesiInput: string
): Record<string, unknown> {
	const map: Record<string, { statusUtama: string; tipeDurasi: string }> = {
		izin: { statusUtama: 'IZIN', tipeDurasi: 'FULL_DAY' },
		izin_setengah_hari: { statusUtama: 'IZIN', tipeDurasi: 'HALF_DAY' },
		izin_terlambat: { statusUtama: 'IZIN', tipeDurasi: 'FULL_DAY' },
		sakit: { statusUtama: 'SAKIT', tipeDurasi: 'FULL_DAY' }
	};
	const m = map[jenis] || map.izin;
	const d = susunPayloadDurasi({
		statusUtama: m.statusUtama,
		tipeDurasi: m.tipeDurasi,
		sesi: sesiInput || null
	});
	return {
		tipe_durasi: d.tipe_durasi,
		sesi: d.sesi,
		jam_mulai_izin: d.jam_mulai_izin,
		jam_selesai_izin: d.jam_selesai_izin,
		total_durasi_jam: d.total_durasi_jam,
		potongan_hari: d.potongan_hari,
		durasi_izin_jam: d.durasi_izin_jam
		// status TIDAK diambil dari helper — endpoint ini punya string legacy khusus
		// ('IZIN TERLAMBAT', 'SAKIT BELUM SURAT DOKTER (IZIN)') yang wajib dipertahankan.
	};
}

// Fase 4: tambah 'izin_setengah_hari' & 'izin_terlambat' — dipotong proporsional jam (T3,
// payrollSync.js), bukan 1 hari penuh seperti 'izin' biasa.
const JENIS_VALID = ['izin', 'sakit', 'izin_setengah_hari', 'izin_terlambat'];
const JENIS_KE_STATUS: Record<string, string> = {
	izin: 'IZIN',
	izin_setengah_hari: 'IZIN 1/2 HARI',
	izin_terlambat: 'IZIN TERLAMBAT'
};

// Manajemen Sakit — dukungan multi-hari (bukan cuma "hari ini"). Lebih dari ini wajib jalur
// Cuti Sakit (cuti_karyawan) yang sudah ada, bukan endpoint ini.
const MAX_SAKIT_RANGE_HARI = 5;
const HARI_KERJA = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
const HARI_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

async function fetchHolidaysInRange(mulai: string, selesai: string): Promise<Set<string>> {
	try {
		const query = new URLSearchParams({
			'filter[date][_gte]': mulai,
			'filter[date][_lte]': selesai,
			'filter[is_active][_neq]': 'false',
			fields: 'date',
			limit: '-1'
		});
		const result = await directusServerJson<{ data: { date: string }[] }>(`/items/holidays?${query.toString()}`);
		return new Set((result?.data || []).map((h) => String(h.date).slice(0, 10)));
	} catch {
		return new Set();
	}
}

/** Tanggal kerja (exclude Sabtu/Minggu + holidays) dalam rentang [mulai, selesai] inklusif. */
async function getHariKerjaDates(mulai: string, selesai: string): Promise<string[]> {
	const start = new Date(`${mulai}T00:00:00`);
	const end = new Date(`${selesai}T00:00:00`);
	if (end < start) return [];
	const holidayDates = await fetchHolidaysInRange(mulai, selesai);
	const dates: string[] = [];
	const cursor = new Date(start);
	while (cursor <= end) {
		const y = cursor.getFullYear();
		const m = String(cursor.getMonth() + 1).padStart(2, '0');
		const d = String(cursor.getDate()).padStart(2, '0');
		const iso = `${y}-${m}-${d}`;
		const namaHari = HARI_NAMES[cursor.getDay()];
		if (HARI_KERJA.includes(namaHari) && !holidayDates.has(iso)) dates.push(iso);
		cursor.setDate(cursor.getDate() + 1);
	}
	return dates;
}

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const form = await event.request.formData();
	const jenis = form.get('jenis')?.toString() || '';
	const alasan = form.get('alasan')?.toString().trim() || '';
	const suratFile = form.get('surat');
	const tanggalSelesaiInput = jenis === 'sakit' ? form.get('tanggal_selesai')?.toString().trim() || '' : '';
	const delegasiKaryawanId = form.get('delegasi_karyawan_id')?.toString().trim() || '';
	const delegasiCatatan = form.get('delegasi_catatan')?.toString().trim() || '';
	const sesiInput = form.get('sesi')?.toString().trim().toUpperCase() || '';

	if (!JENIS_VALID.includes(jenis)) {
		throw error(400, 'Jenis pengajuan tidak valid.');
	}
	if (jenis === 'izin_setengah_hari' && sesiInput !== SESI.PAGI && sesiInput !== SESI.SIANG) {
		throw error(400, 'Pilih sesi (Pagi atau Siang) untuk izin 1/2 hari.');
	}
	if (!alasan) {
		throw error(400, 'Alasan wajib diisi.');
	}
	if (jenis === 'sakit' && !(suratFile instanceof File && suratFile.size > 0)) {
		throw error(400, 'Foto surat keterangan dokter wajib diunggah untuk pengajuan sakit.');
	}
	if (!delegasiKaryawanId) {
		throw error(400, 'Pilih rekan kerja yang menerima delegasi tugas selama Anda tidak hadir.');
	}
	if (String(delegasiKaryawanId) === String(karyawan.id)) {
		throw error(400, 'Delegasi tugas tidak boleh diisi dengan diri sendiri.');
	}
	if (!delegasiCatatan || delegasiCatatan.length < 5) {
		throw error(400, 'Jelaskan tugas/tanggung jawab yang didelegasikan (wajib diisi).');
	}

	const tanggal = todayJakarta();

	// Sakit multi-hari (rentang tanggal_mulai=hari ini s/d tanggal_selesai). Rentang > 5 hari
	// kalender wajib jalur Cuti Sakit (cuti_karyawan) yang sudah ada, bukan endpoint ini.
	if (jenis === 'sakit' && tanggalSelesaiInput && tanggalSelesaiInput > tanggal) {
		const diffHari = Math.round((new Date(`${tanggalSelesaiInput}T00:00:00`).getTime() - new Date(`${tanggal}T00:00:00`).getTime()) / 86400000) + 1;
		if (diffHari > MAX_SAKIT_RANGE_HARI) {
			throw error(400, `Sakit lebih dari ${MAX_SAKIT_RANGE_HARI} hari wajib diajukan lewat jalur Cuti Sakit, bukan di sini.`);
		}

		const existingToday = await findTodayRecord(karyawan.id, tanggal);
		if (existingToday && !isEmptyTime(existingToday.jam_masuk)) {
			throw error(409, 'Anda sudah tercatat hadir hari ini — pengajuan izin/sakit hanya berlaku sebelum absen masuk.');
		}

		const uploadForm = new FormData();
		uploadForm.append('file', suratFile as File, `surat-sakit-${karyawan.id}-${Date.now()}.jpg`);
		const uploadRes = await directusServerUpload(uploadForm);
		if (!uploadRes.ok) throw error(502, 'Gagal mengunggah foto surat.');
		const fotoSuratId = (await uploadRes.json())?.data?.id || null;

		const dates = await getHariKerjaDates(tanggal, tanggalSelesaiInput);
		if (dates.length === 0) {
			throw error(400, 'Rentang tanggal yang dipilih tidak mengandung hari kerja.');
		}

		const kelompokSakitId = crypto.randomUUID();
		const createdIds: string[] = [];
		for (const tgl of dates) {
			const existing = tgl === tanggal ? existingToday : await findTodayRecord(karyawan.id, tgl);
			if (existing && !isEmptyTime(existing.jam_masuk)) continue; // sudah tercatat hadir hari itu, lewati

			const payload = {
				karyawan_id: String(karyawan.id),
				tanggal: tgl,
				status: 'SAKIT BELUM SURAT DOKTER (IZIN)',
				keterangan: alasan,
				foto_surat_dokter: fotoSuratId,
				kelompok_sakit_id: kelompokSakitId,
				sumber: 'ESS',
				delegasi_karyawan_id: delegasiKaryawanId,
				delegasi_catatan: delegasiCatatan,
				...kolomDurasi('sakit', 'SAKIT BELUM SURAT DOKTER (IZIN)', '')
			};
			const result = existing
				? await directusServerJson(`/items/absensi_harian/${existing.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
				: await directusServerJson('/items/absensi_harian', { method: 'POST', body: JSON.stringify(payload) });
			const id = result?.data?.id ?? result?.id;
			if (id) createdIds.push(id);
		}

		if (createdIds.length === 0) {
			throw error(409, 'Seluruh hari dalam rentang tersebut sudah tercatat hadir.');
		}

		try {
			await mirrorSubmitApprovalRequest({
				moduleKey: 'hrd.izin_sakit',
				sourceCollection: 'absensi_harian',
				sourceId: createdIds[0],
				title: `Sakit ${tanggal} s/d ${tanggalSelesaiInput} — ${karyawan.nama_karyawan}`,
				summary: alasan,
				amount: null,
				departmentKey: karyawan.divisi,
				requesterId: karyawan.id
			});
		} catch (e) {
			console.warn('[approvalMirror] gagal mendaftarkan izin/sakit ke Inbox terpusat:', e);
		}

		return json({ recordIds: createdIds, kelompokSakitId });
	}

	const existing = await findTodayRecord(karyawan.id, tanggal);
	if (existing && !isEmptyTime(existing.jam_masuk)) {
		throw error(409, 'Anda sudah tercatat hadir hari ini — pengajuan izin/sakit hanya berlaku sebelum absen masuk.');
	}

	let fotoSuratId: string | null = null;
	if (suratFile instanceof File && suratFile.size > 0) {
		const uploadForm = new FormData();
		uploadForm.append('file', suratFile, `surat-${jenis}-${karyawan.id}-${Date.now()}.jpg`);
		const uploadRes = await directusServerUpload(uploadForm);
		if (!uploadRes.ok) throw error(502, 'Gagal mengunggah foto surat.');
		fotoSuratId = (await uploadRes.json())?.data?.id || null;
	}

	const status = jenis === 'sakit' ? 'SAKIT BELUM SURAT DOKTER (IZIN)' : JENIS_KE_STATUS[jenis];

	const payload = {
		karyawan_id: String(karyawan.id),
		tanggal,
		status,
		keterangan: alasan,
		foto_surat_dokter: fotoSuratId,
		sumber: 'ESS',
		delegasi_karyawan_id: delegasiKaryawanId,
		delegasi_catatan: delegasiCatatan,
		...kolomDurasi(jenis, status, sesiInput)
	};

	const result = existing
		? await directusServerJson(`/items/absensi_harian/${existing.id}`, {
				method: 'PATCH',
				body: JSON.stringify(payload)
			})
		: await directusServerJson('/items/absensi_harian', {
				method: 'POST',
				body: JSON.stringify(payload)
			});

	const recordId = result?.data?.id ?? result?.id;
	try {
		await mirrorSubmitApprovalRequest({
			moduleKey: 'hrd.izin_sakit',
			sourceCollection: 'absensi_harian',
			sourceId: recordId,
			title: `${jenis === 'sakit' ? 'Sakit' : 'Izin'} — ${karyawan.nama_karyawan}`,
			summary: alasan,
			amount: null,
			departmentKey: karyawan.divisi,
			requesterId: karyawan.id
		});
	} catch (e) {
		console.warn('[approvalMirror] gagal mendaftarkan izin/sakit ke Inbox terpusat:', e);
	}

	return json({ record: result?.data ?? result });
};

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const today = todayJakarta();

	const todayDate = new Date(`${today}T00:00:00`);
	const cutoffDate = new Date(todayDate);
	cutoffDate.setDate(cutoffDate.getDate() - 90);
	const cutoffIso = cutoffDate.toISOString().slice(0, 10);
	const startOfMonth = `${today.slice(0, 7)}-01`;

	try {
		const query = new URLSearchParams({
			'filter[karyawan_id][_eq]': String(karyawan.id),
			'filter[tanggal][_gte]': cutoffIso,
			fields: 'id,tanggal,status,keterangan,foto_surat_dokter,kelompok_sakit_id,jam_masuk,jam_keluar,sumber,date_created,tipe_durasi,sesi,jam_mulai_izin,jam_selesai_izin,total_durasi_jam,potongan_hari',
			sort: '-tanggal',
			limit: '100'
		});

		const result = await directusServerJson<{ data: any[] }>(`/items/absensi_harian?${query.toString()}`);
		const allRecords = result?.data || [];

		const records = allRecords.filter((r) => {
			const st = String(r.status || '').toUpperCase();
			return st.includes('IZIN') || st.includes('SAKIT') || !!r.foto_surat_dokter || !!r.kelompok_sakit_id;
		});

		let totalIzinBulanIni = 0;
		let sakitTerverifikasiBulanIni = 0;
		let sakitPendingBulanIni = 0;
		let izinTerlambatBulanIni = 0;

		for (const r of records) {
			if (r.tanggal >= startOfMonth) {
				const st = String(r.status || '').toUpperCase();
				if (st === 'IZIN' || st === 'IZIN 1/2 HARI') totalIzinBulanIni++;
				if (st === 'IZIN TERLAMBAT') izinTerlambatBulanIni++;
				if (st === 'SAKIT') sakitTerverifikasiBulanIni++;
				if (st.includes('SAKIT BELUM SURAT DOKTER') || (st.includes('SAKIT') && st.includes('BELUM'))) sakitPendingBulanIni++;
			}
		}

		return json({
			records,
			summary: {
				totalIzinBulanIni,
				sakitTerverifikasiBulanIni,
				sakitPendingBulanIni,
				izinTerlambatBulanIni
			},
			today
		});
	} catch (err: any) {
		console.warn('[izin-sakit:GET] gagal mengambil data riwayat:', err);
		return json({
			records: [],
			summary: {
				totalIzinBulanIni: 0,
				sakitTerverifikasiBulanIni: 0,
				sakitPendingBulanIni: 0,
				izinTerlambatBulanIni: 0
			},
			today
		});
	}
};
