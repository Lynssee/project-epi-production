// src/lib/server/ess/cuti.ts
// Query helper server-side untuk /api/ess/cuti/* — replikasi rumus & aturan bisnis
// dari HrdCuti.svelte / hrdCutiApi.js (erp-epi-1) supaya perilaku konsisten
// dengan Admin HRD, tanpa mengubah kode di sana.

import { directusServerJson } from '$lib/server/directus';
import { listKaryawanIdsByDivisi } from '$lib/server/ess/divisi';
import { todayJakarta } from '$lib/server/ess/time';

export interface CutiRecord {
	id: string;
	karyawan_id: string;
	jenis_cuti: string;
	tanggal_mulai: string;
	tanggal_selesai: string;
	jumlah_hari: number;
	status: string;
	alasan: string | null;
	disetujui_oleh: string | null;
	catatan_hr: string | null;
	approver_id: string | null;
	approved_at: string | null;
	date_created?: string;
	delegasi_karyawan_id?: string | number | null;
	/** UUID file directus_files — lampiran dokumen pendukung (mis. surat dokter untuk Cuti Sakit). */
	lampiran?: string | null;
}

const CUTI_FIELDS = [
	'id',
	'karyawan_id',
	'jenis_cuti',
	'tanggal_mulai',
	'tanggal_selesai',
	'jumlah_hari',
	'status',
	'alasan',
	'disetujui_oleh',
	'catatan_hr',
	'approver_id',
	'approved_at',
	'date_created',
	'delegasi_karyawan_id',
	'paruh',
	'lampiran'
].join(',');

const HARI_KERJA_DEFAULT = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
const HARI_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/** Ambil tanggal libur (holidays) aktif dalam rentang [mulai, selesai], return Set 'YYYY-MM-DD' */
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

/**
 * Hitung jumlah hari kerja antara mulai-selesai (inklusif), exclude Sabtu/Minggu dan
 * tanggal yang ada di koleksi holidays. Rumus identik dengan hitungHariKerja() di
 * hrdCutiApi.js (erp-epi-1) supaya konsisten dengan Admin HRD.
 */
export async function calcJumlahHari(mulai: string, selesai: string): Promise<number> {
	if (!mulai || !selesai) return 0;
	const start = new Date(`${mulai}T00:00:00`);
	const end = new Date(`${selesai}T00:00:00`);
	if (end < start) return 0;

	const holidayDates = await fetchHolidaysInRange(mulai, selesai);
	const allowed = new Set(HARI_KERJA_DEFAULT);

	let count = 0;
	const cursor = new Date(start);
	while (cursor <= end) {
		const y = cursor.getFullYear();
		const m = String(cursor.getMonth() + 1).padStart(2, '0');
		const d = String(cursor.getDate()).padStart(2, '0');
		const iso = `${y}-${m}-${d}`;
		const namaHari = HARI_NAMES[cursor.getDay()];
		if (allowed.has(namaHari) && !holidayDates.has(iso)) {
			count += 1;
		}
		cursor.setDate(cursor.getDate() + 1);
	}
	return count;
}

export async function findCutiById(id: string): Promise<CutiRecord | null> {
	try {
		const result = await directusServerJson<{ data: CutiRecord }>(
			`/items/cuti_karyawan/${id}?fields=${CUTI_FIELDS}`
		);
		return result?.data || null;
	} catch {
		return null;
	}
}

export async function listCutiByKaryawan(karyawanId: number): Promise<CutiRecord[]> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		fields: CUTI_FIELDS,
		sort: '-tanggal_mulai',
		limit: '100'
	});
	const result = await directusServerJson<{ data: CutiRecord[] }>(`/items/cuti_karyawan?${query.toString()}`);
	return result?.data || [];
}

/** Inbox approval: pengajuan status Diajukan milik karyawan lain di divisi yang sama. */
export async function listPendingCutiForDivisi(divisi: string, excludeKaryawanId: number): Promise<CutiRecord[]> {
	if (!divisi) return [];
	const idsInDivisi = await listKaryawanIdsByDivisi(divisi);
	const targetIds = idsInDivisi.filter((id) => id !== excludeKaryawanId);
	if (targetIds.length === 0) return [];

	const query = new URLSearchParams({
		'filter[karyawan_id][_in]': targetIds.join(','),
		'filter[status][_eq]': 'Diajukan',
		fields: CUTI_FIELDS,
		sort: 'tanggal_mulai',
		limit: '100'
	});
	const result = await directusServerJson<{ data: CutiRecord[] }>(`/items/cuti_karyawan?${query.toString()}`);
	return result?.data || [];
}

/** Riwayat approval: pengajuan cuti yang sudah diproses (Disetujui/Ditolak) milik karyawan divisi yang sama. */
export async function listHistoryCutiForDivisi(divisi: string, excludeKaryawanId: number): Promise<CutiRecord[]> {
	if (!divisi) return [];
	const idsInDivisi = await listKaryawanIdsByDivisi(divisi);
	const targetIds = idsInDivisi.filter((id) => id !== excludeKaryawanId);
	if (targetIds.length === 0) return [];

	const query = new URLSearchParams({
		'filter[karyawan_id][_in]': targetIds.join(','),
		'filter[status][_neq]': 'Diajukan',
		fields: CUTI_FIELDS,
		sort: '-approved_at,-date_created',
		limit: '100'
	});
	const result = await directusServerJson<{ data: CutiRecord[] }>(`/items/cuti_karyawan?${query.toString()}`);
	return result?.data || [];
}


const CUTI_ABSENSI_STATUSES = new Set(['CUTI', 'CUTI 1/2 HARI', 'CUTI KHUSUS']);

function mapJenisCutiToAbsensiStatus(jenisCuti: string | null | undefined): string {
	return String(jenisCuti || '').trim() === 'Cuti Khusus' ? 'CUTI KHUSUS' : 'CUTI';
}

interface AbsensiHarianRecord {
	id: string;
	tanggal: string;
	status: string;
	jam_masuk: string | null;
}

/**
 * Perbaikan K1: cuti disetujui (via ESS) tidak tersambung ke absensi_harian, sehingga
 * payroll (erp-epi-1: payrollSync.js) menghitung hari cuti sebagai ALPA. Replikasi
 * generateAbsensiForApprovedCuti() di hrdCutiApi.js supaya perilaku sama persis dengan
 * approval dari Admin HRD. Idempotent: hari yang sudah punya absensi CUTI/jam_masuk asli dilewati.
 */
export async function applyCutiApprovalToAbsensi(cuti: {
	karyawan_id: string;
	tanggal_mulai: string;
	tanggal_selesai: string;
	jenis_cuti?: string | null;
}): Promise<{ created: number; updated: number; skipped: number }> {
	const result = { created: 0, updated: 0, skipped: 0 };
	const { karyawan_id, tanggal_mulai, tanggal_selesai, jenis_cuti } = cuti;
	if (!karyawan_id || !tanggal_mulai || !tanggal_selesai) return result;

	const holidayDates = await fetchHolidaysInRange(tanggal_mulai, tanggal_selesai);
	const start = new Date(`${tanggal_mulai}T00:00:00`);
	const end = new Date(`${tanggal_selesai}T00:00:00`);
	if (end < start) return result;

	const allowed = new Set(HARI_KERJA_DEFAULT);
	const dates: string[] = [];
	const cursor = new Date(start);
	while (cursor <= end) {
		const y = cursor.getFullYear();
		const m = String(cursor.getMonth() + 1).padStart(2, '0');
		const d = String(cursor.getDate()).padStart(2, '0');
		const iso = `${y}-${m}-${d}`;
		const namaHari = HARI_NAMES[cursor.getDay()];
		if (allowed.has(namaHari) && !holidayDates.has(iso)) dates.push(iso);
		cursor.setDate(cursor.getDate() + 1);
	}
	if (dates.length === 0) return result;

	const status = mapJenisCutiToAbsensiStatus(jenis_cuti);
	const keterangan = `Cuti disetujui: ${jenis_cuti || 'Cuti'}`;

	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawan_id),
		'filter[tanggal][_gte]': dates[0],
		'filter[tanggal][_lte]': dates[dates.length - 1],
		fields: 'id,tanggal,status,jam_masuk',
		limit: '-1'
	});
	const existingRes = await directusServerJson<{ data: AbsensiHarianRecord[] }>(
		`/items/absensi_harian?${query.toString()}`
	);
	const existingByDate = new Map(
		(existingRes?.data || []).map((a) => [String(a.tanggal || '').slice(0, 10), a])
	);

	for (const tanggal of dates) {
		const existing = existingByDate.get(tanggal);
		if (existing) {
			if (existing.jam_masuk || CUTI_ABSENSI_STATUSES.has(String(existing.status || '').toUpperCase())) {
				result.skipped++;
				continue;
			}
			await directusServerJson(`/items/absensi_harian/${existing.id}`, {
				method: 'PATCH',
				body: JSON.stringify({ status, keterangan })
			});
			result.updated++;
		} else {
			await directusServerJson(`/items/absensi_harian`, {
				method: 'POST',
				body: JSON.stringify({ karyawan_id, tanggal, status, keterangan, sumber: 'cuti_approval' })
			});
			result.created++;
		}
	}
	return result;
}

interface KebijakanCuti {
	hak_tahunan_hari: number;
	carry_over_expiry_bulan: number;
	carry_over_expiry_tanggal: number;
	cuti_bersama_potong_kuota: boolean;
}
const DEFAULT_KEBIJAKAN_CUTI: KebijakanCuti = {
	hak_tahunan_hari: 12,
	carry_over_expiry_bulan: 3,
	carry_over_expiry_tanggal: 31,
	cuti_bersama_potong_kuota: true
};

/** Jenis yang dikecualikan dari aturan "tidak dadakan" — sakit bersifat darurat/tidak terduga. */
const JENIS_DIKECUALIKAN_DADAKAN = new Set(['Cuti Sakit']);

/** Tambah N hari kalender ke tanggal YYYY-MM-DD (aritmetika UTC — bebas efek timezone server). */
function tambahHari(iso: string, n: number): string {
	const [y, m, d] = iso.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export interface AturanPengajuanCuti {
	/** kebijakan_cuti.minimum_hari_pengajuan (hari kalender, hari pengajuan ikut dihitung). */
	minimumHari: number;
	/** Hari ini menurut WIB (YYYY-MM-DD). */
	hariIni: string;
	/** Tanggal mulai paling cepat untuk jenis cuti yang tidak dikecualikan. */
	tanggalMinimum: string;
	/** Jenis cuti yang boleh mulai kapan saja (mis. Cuti Sakit). */
	jenisDikecualikan: string[];
}

/**
 * Aturan "tidak dadakan": hari pengajuan + (minimumHari - 1) hari kalender berikutnya diblokir.
 * Contoh minimumHari = 3, ajukan Kamis 24 → 24, 25, 26 diblokir → paling cepat mulai 27.
 * Sabtu/Minggu/libur ikut dihitung (hari kalender), sesuai kebijakan HRD.
 */
export async function getAturanPengajuanCuti(): Promise<AturanPengajuanCuti> {
	const hariIni = todayJakarta();
	const minimumHari = Math.max(0, Number(await fetchKebijakanCutiMinimum(Number(hariIni.slice(0, 4)))) || 0);
	return {
		minimumHari,
		hariIni,
		tanggalMinimum: tambahHari(hariIni, minimumHari),
		jenisDikecualikan: [...JENIS_DIKECUALIKAN_DADAKAN]
	};
}

/**
 * Cegah pengajuan Cuti/Izin yang dadakan — lihat getAturanPengajuanCuti(). Cuti Sakit dikecualikan
 * (tidak bisa direncanakan).
 */
export async function assertTidakDadakan(jenisCuti: string, tanggalMulai: string): Promise<void> {
	if (JENIS_DIKECUALIKAN_DADAKAN.has(jenisCuti)) return;
	const { minimumHari, hariIni, tanggalMinimum } = await getAturanPengajuanCuti();
	if (minimumHari <= 0) return;

	if (tanggalMulai < tanggalMinimum) {
		throw new Error(
			`Pengajuan ${jenisCuti} tidak boleh dadakan: hari pengajuan dan ${minimumHari - 1} hari berikutnya tidak bisa dipilih. ` +
				`Diajukan ${hariIni}, tanggal mulai paling cepat ${tanggalMinimum}. Hubungi HRD langsung bila ini keadaan darurat.`
		);
	}
}

async function fetchKebijakanCutiMinimum(tahun: number): Promise<number> {
	try {
		const result = await directusServerJson<{ data: { minimum_hari_pengajuan: number }[] }>(
			`/items/kebijakan_cuti?filter[tahun_berlaku][_eq]=${tahun}&limit=1&fields=minimum_hari_pengajuan`
		);
		return result?.data?.[0]?.minimum_hari_pengajuan ?? 3;
	} catch {
		return 3;
	}
}

async function fetchKebijakanCuti(tahun: number): Promise<KebijakanCuti> {
	try {
		const result = await directusServerJson<{ data: Partial<KebijakanCuti>[] }>(
			`/items/kebijakan_cuti?filter[tahun_berlaku][_eq]=${tahun}&limit=1`
		);
		const found = result?.data?.[0];
		return found ? { ...DEFAULT_KEBIJAKAN_CUTI, ...found } : DEFAULT_KEBIJAKAN_CUTI;
	} catch {
		return DEFAULT_KEBIJAKAN_CUTI;
	}
}

/** Cuti bersama baru memotong kuota setelah tanggalnya lewat — hindari pemotongan di muka untuk hari libur yang belum terjadi. */
async function fetchCutiBersamaCount(tahun: number): Promise<number> {
	try {
		const todayStr = new Date().toISOString().slice(0, 10);
		const batasAkhir = todayStr < `${tahun}-12-31` ? todayStr : `${tahun}-12-31`;
		const query = new URLSearchParams({
			'filter[is_cuti_bersama][_eq]': 'true',
			'filter[date][_gte]': `${tahun}-01-01`,
			'filter[date][_lte]': batasAkhir,
			'filter[is_active][_neq]': 'false',
			fields: 'id',
			limit: '-1'
		});
		const result = await directusServerJson<{ data: { id: number }[] }>(`/items/holidays?${query.toString()}`);
		return (result?.data || []).length;
	} catch {
		return 0;
	}
}

function hitungHakProrata(hakPenuh: number, tanggalMasuk: string | null, tahun: number): number {
	if (!tanggalMasuk) return hakPenuh;
	const [mY, mM] = tanggalMasuk.split('-').map(Number);
	if (mY !== tahun) return hakPenuh;
	const bulanEfektif = 12 - (mM - 1);
	return Math.round((hakPenuh * bulanEfektif) / 12);
}

async function sumCutiTahunanTerpakai(karyawanId: number, tahun: number): Promise<number> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		'filter[status][_eq]': 'Disetujui',
		'filter[jenis_cuti][_eq]': 'Cuti Tahunan',
		'filter[tanggal_mulai][_gte]': `${tahun}-01-01`,
		'filter[tanggal_mulai][_lte]': `${tahun}-12-31`,
		fields: 'jumlah_hari',
		limit: '-1'
	});
	const result = await directusServerJson<{ data: { jumlah_hari: number }[] }>(`/items/cuti_karyawan?${query.toString()}`);
	return (result?.data || []).reduce((sum, c) => sum + (Number(c.jumlah_hari) || 0), 0);
}

/**
 * Fase 4 (4.2/4.4): saldo cuti tahunan — replikasi getSisaCuti() di hrdCutiApi.js (erp-epi-1)
 * supaya konsisten dengan Admin HRD: prorata masa kerja, carry-over (hangus sesuai kebijakan_cuti),
 * cuti bersama memotong kuota. HANYA jenis 'Cuti Tahunan'.
 */
export async function getSisaCutiTahunIni(
	karyawanId: number,
	includeCarryOver = true
): Promise<{ total_hak: number; terpakai: number; sisa: number; terpakai_pengajuan: number; potongan_cuti_bersama: number }> {
	const tahun = new Date().getFullYear();
	const [kebijakan, karyawanRes, terpakai, cutiBersamaCount] = await Promise.all([
		fetchKebijakanCuti(tahun),
		directusServerJson<{ data: { tanggal_masuk: string | null } }>(`/items/karyawan/${karyawanId}?fields=tanggal_masuk`),
		sumCutiTahunanTerpakai(karyawanId, tahun),
		fetchCutiBersamaCount(tahun)
	]);

	const hakProrata = hitungHakProrata(kebijakan.hak_tahunan_hari, karyawanRes?.data?.tanggal_masuk || null, tahun);

	let carryOver = 0;
	if (includeCarryOver) {
		const now = new Date();
		const expiry = new Date(tahun, kebijakan.carry_over_expiry_bulan - 1, kebijakan.carry_over_expiry_tanggal);
		if (now <= expiry) {
			const sisaTahunLalu = await getSisaCutiTahunLalu(karyawanId, tahun - 1);
			carryOver = Math.max(0, sisaTahunLalu.sisa);
		}
	}

	const potonganCutiBersama = kebijakan.cuti_bersama_potong_kuota ? cutiBersamaCount : 0;
	const totalHak = hakProrata + carryOver;
	const totalTerpakai = terpakai + potonganCutiBersama;
	return {
		total_hak: totalHak,
		terpakai: totalTerpakai,
		sisa: totalHak - totalTerpakai,
		terpakai_pengajuan: terpakai,
		potongan_cuti_bersama: potonganCutiBersama
	};
}

/** 1 langkah rekursi (tanpa carry-over lagi) untuk hitung sisa cuti tahun sebelumnya — cegah rantai tak berujung. */
async function getSisaCutiTahunLalu(karyawanId: number, tahun: number): Promise<{ total_hak: number; terpakai: number; sisa: number }> {
	const [kebijakan, karyawanRes, terpakai, cutiBersamaCount] = await Promise.all([
		fetchKebijakanCuti(tahun),
		directusServerJson<{ data: { tanggal_masuk: string | null } }>(`/items/karyawan/${karyawanId}?fields=tanggal_masuk`),
		sumCutiTahunanTerpakai(karyawanId, tahun),
		fetchCutiBersamaCount(tahun)
	]);
	const hakProrata = hitungHakProrata(kebijakan.hak_tahunan_hari, karyawanRes?.data?.tanggal_masuk || null, tahun);
	const potonganCutiBersama = kebijakan.cuti_bersama_potong_kuota ? cutiBersamaCount : 0;
	return { total_hak: hakProrata, terpakai: terpakai + potonganCutiBersama, sisa: hakProrata - (terpakai + potonganCutiBersama) };
}
