import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { calcJumlahHari, assertTidakDadakan } from '$lib/server/ess/cuti';
import { mirrorSubmitApprovalRequest } from '$lib/server/approvalMirror';
import { createMasterPengajuanEntry } from '$lib/server/masterPengajuanSubmit';

const JENIS_CUTI_VALID = ['Cuti Tahunan', 'Cuti Sakit', 'Cuti Melahirkan', 'Cuti Khusus', 'Cuti Tidak Berbayar', 'Lainnya'];
// Fase 4.3 (UU 13/2003 Ps. 93) — kuota terpisah, tidak mengurangi cuti tahunan. Harus sinkron
// dengan CUTI_KHUSUS_KUOTA di hrdCutiApi.js (erp-epi-1).
const SUB_JENIS_CUTI_KHUSUS_VALID = [
	'Menikah', 'Menikahkan Anak', 'Mengkhitankan/Membaptiskan Anak',
	'Istri Melahirkan/Keguguran', 'Keluarga Meninggal (Serumah)', 'Keluarga Meninggal (Tidak Serumah)'
];

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	// Body selalu FormData — lampiran opsional, hanya dipakai bila field 'lampiran' berisi File
	// (mis. surat dokter untuk Cuti Sakit).
	const form = await event.request.formData().catch(() => null);
	if (!form) throw error(400, 'Format permintaan tidak dikenali.');

	const jenisCuti = form.get('jenis_cuti')?.toString() || '';
	const subJenisCutiKhusus = form.get('sub_jenis_cuti_khusus')?.toString().trim() || null;
	const tanggalMulai = form.get('tanggal_mulai')?.toString() || '';
	const tanggalSelesai = form.get('tanggal_selesai')?.toString() || '';
	const paruhRaw = form.get('paruh')?.toString().toLowerCase().trim() || '';
	const alasan = form.get('alasan')?.toString().trim() || '';
	const delegasiKaryawanId = form.get('delegasi_karyawan_id')?.toString().trim() || '';
	const delegasiCatatan = form.get('delegasi_catatan')?.toString().trim() || '';
	const lampiranFile = form.get('lampiran');

	if (!JENIS_CUTI_VALID.includes(jenisCuti)) {
		throw error(400, 'Jenis cuti tidak valid.');
	}
	if (jenisCuti === 'Cuti Khusus' && !SUB_JENIS_CUTI_KHUSUS_VALID.includes(subJenisCutiKhusus || '')) {
		throw error(400, 'Pilih jenis cuti khusus yang valid (UU 13/2003 Ps. 93).');
	}
	if (!tanggalMulai || !tanggalSelesai) {
		throw error(400, 'Tanggal mulai dan selesai wajib diisi.');
	}
	if (tanggalSelesai < tanggalMulai) {
		throw error(400, 'Tanggal selesai tidak boleh sebelum tanggal mulai.');
	}
	// Cuti 1/2 hari (paruh) hanya untuk 1 tanggal (mulai === selesai).
	const isSetengahHari = paruhRaw === 'pagi' || paruhRaw === 'siang';
	if (paruhRaw && !isSetengahHari) {
		throw error(400, 'Paruh cuti harus "pagi" atau "siang".');
	}
	if (isSetengahHari && tanggalMulai !== tanggalSelesai) {
		throw error(400, 'Cuti 1/2 hari hanya berlaku untuk satu tanggal (mulai = selesai).');
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

	try {
		await assertTidakDadakan(jenisCuti, tanggalMulai);
	} catch (e: any) {
		throw error(400, e.message);
	}

	// jumlah_hari dihitung di server — jangan percaya nilai dari klien.
	// Cuti 1/2 hari = 0.5 HK; tetap tolak bila tanggalnya bukan hari kerja (weekend/holiday).
	let jumlahHari: number;
	if (isSetengahHari) {
		const hkTanggal = await calcJumlahHari(tanggalMulai, tanggalMulai);
		if (hkTanggal === 0) {
			throw error(400, 'Tanggal yang dipilih bukan hari kerja — cuti 1/2 hari tidak berlaku.');
		}
		jumlahHari = 0.5;
	} else {
		jumlahHari = await calcJumlahHari(tanggalMulai, tanggalSelesai);
	}

	let lampiranId: string | null = null;
	if (lampiranFile instanceof File && lampiranFile.size > 0) {
		const uploadForm = new FormData();
		uploadForm.append('file', lampiranFile, lampiranFile.name || `lampiran-cuti-${karyawan.id}-${Date.now()}`);
		const uploadRes = await directusServerUpload(uploadForm);
		if (!uploadRes.ok) throw error(502, 'Gagal mengunggah lampiran.');
		lampiranId = (await uploadRes.json())?.data?.id || null;
	}

	const payload = {
		karyawan_id: String(karyawan.id),
		jenis_cuti: jenisCuti,
		sub_jenis_cuti_khusus: jenisCuti === 'Cuti Khusus' ? subJenisCutiKhusus : null,
		tanggal_mulai: tanggalMulai,
		tanggal_selesai: tanggalSelesai,
		jumlah_hari: jumlahHari,
		paruh: isSetengahHari ? paruhRaw : null,
		status: 'Diajukan',
		alasan,
		delegasi_karyawan_id: delegasiKaryawanId,
		delegasi_catatan: delegasiCatatan,
		lampiran: lampiranId
	};

	const result = await directusServerJson('/items/cuti_karyawan', {
		method: 'POST',
		body: JSON.stringify(payload)
	});

	const recordId = result?.data?.id ?? result?.id;
	const labelDurasi = isSetengahHari ? ` (1/2 hari - ${paruhRaw === 'pagi' ? 'Pagi' : 'Siang'})` : '';
	try {
		await mirrorSubmitApprovalRequest({
			moduleKey: 'hrd.cuti',
			sourceCollection: 'cuti_karyawan',
			sourceId: recordId,
			title: `Cuti ${jenisCuti}${labelDurasi} — ${karyawan.nama_karyawan}`,
			summary: alasan || null,
			amount: null,
			departmentKey: karyawan.divisi,
			requesterId: karyawan.id
		});
	} catch (e) {
		console.warn('[approvalMirror] gagal mendaftarkan cuti ke Inbox terpusat:', e);
	}

	createMasterPengajuanEntry({
		kategori: 'hrd',
		jenisPengajuan: 'CTI',
		judul: `Cuti ${jenisCuti}${labelDurasi} — ${karyawan.nama_karyawan}`,
		deskripsi: alasan || null,
		pengajuId: karyawan.id,
		departmentKey: karyawan.divisi,
		detailRefCollection: 'cuti_karyawan',
		detailRefId: recordId,
		sourceApp: 'field'
	}).catch((e: any) => console.warn('[masterPengajuanSubmit] gagal katalog CTI (diabaikan):', e?.message));

	return json({ record: result?.data ?? result });
};
