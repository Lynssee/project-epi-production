// src/lib/server/ess/kasbon.ts
// Query helper server-side untuk /api/ess/kasbon/* — Fase 3 Rencana Perbaikan HR & Payroll.
// Replikasi pola cuti/reimburse (assertCanApprove, mirror ke Universal Approval Engine).

import { directusServerJson } from '$lib/server/directus';
import { listKaryawanIdsByDivisi, listKaryawanIdsUnderKepala } from '$lib/server/ess/divisi';

export interface KasbonRecord {
	id: number;
	karyawan_id: number;
	nominal: number;
	tenor: number;
	keterangan: string | null;
	status: string;
	tanggal_pengajuan: string;
	cicilan_per_bulan: number | null;
	total_paid: number;
	payment_status: string;
	catatan_penolakan: string | null;
	is_arsip_historis?: boolean;
	last_payment_date?: string | null;
	tanggal_mulai_potong?: string | null;
}

const KASBON_FIELDS = [
	'id', 'karyawan_id', 'nominal', 'tenor', 'keterangan', 'status', 'tanggal_pengajuan',
	'cicilan_per_bulan', 'total_paid', 'payment_status', 'catatan_penolakan', 'is_arsip_historis',
	'last_payment_date', 'tanggal_mulai_potong'
].join(',');

/** Status yang dianggap "kasbon masih berjalan" (belum lunas & belum ditolak) — dipakai
 * validasi maks-1-kasbon-aktif saat submit baru (keputusan user Fase 3). */
const STATUS_AKTIF = ['Diajukan', 'Disetujui Atasan', 'Disetujui HRD', 'approved'];

export async function findKasbonById(id: string | number): Promise<KasbonRecord | null> {
	try {
		const result = await directusServerJson<{ data: KasbonRecord }>(`/items/kasbon/${id}?fields=${KASBON_FIELDS}`);
		return result?.data || null;
	} catch {
		return null;
	}
}

export async function listKasbonByKaryawan(karyawanId: number): Promise<KasbonRecord[]> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		fields: KASBON_FIELDS,
		sort: '-tanggal_pengajuan',
		limit: '100'
	});
	const result = await directusServerJson<{ data: KasbonRecord[] }>(`/items/kasbon?${query.toString()}`);
	return result?.data || [];
}

/** Inbox approval LAMA: "divisi sama & bukan diri sendiri" — dipertahankan untuk cuti/lembur/
 * reimbursement (assertCanApprove umum), TIDAK dipakai lagi oleh kasbon (lihat
 * listPendingKasbonForKepala, T5/Q3). */
export async function listPendingKasbonForDivisi(divisi: string, excludeKaryawanId: number): Promise<KasbonRecord[]> {
	if (!divisi) return [];
	const idsInDivisi = await listKaryawanIdsByDivisi(divisi);
	const targetIds = idsInDivisi.filter((id) => id !== excludeKaryawanId);
	if (targetIds.length === 0) return [];

	const query = new URLSearchParams({
		'filter[karyawan_id][_in]': targetIds.join(','),
		'filter[status][_eq]': 'Diajukan',
		fields: KASBON_FIELDS,
		sort: 'tanggal_pengajuan',
		limit: '100'
	});
	const result = await directusServerJson<{ data: KasbonRecord[] }>(`/items/kasbon?${query.toString()}`);
	return result?.data || [];
}

/** Fase 2 kasbon (Q3, T5): inbox approval tahap-1 berbasis kepala divisi/unit (bukan lagi
 * "divisi sama"). Menampilkan: (a) pengajuan divisi yang approverKaryawanId adalah kepala
 * divisinya (atau pejabat pengganti yang didelegasikan), DAN (b) untuk HRD, seluruh pengajuan
 * yang sudah menggantung >24 jam (eskalasi otomatis, Q3). */
export async function listPendingKasbonForKepala(
	approverKaryawanId: number,
	approverDivisi: string | null,
	excludeKaryawanId: number
): Promise<KasbonRecord[]> {
	// Keanggotaan divisi ditentukan di satu tempat (listKaryawanIdsUnderKepala) supaya inbox
	// dan guard approve/reject tidak bisa berbeda aturan.
	const targetIds = new Set(await listKaryawanIdsUnderKepala(approverKaryawanId, excludeKaryawanId));

	const isHrd = (approverDivisi || '').toUpperCase().includes('HRD');
	const results: KasbonRecord[] = [];

	if (targetIds.size > 0) {
		const query = new URLSearchParams({
			'filter[karyawan_id][_in]': [...targetIds].join(','),
			'filter[status][_eq]': 'Diajukan',
			fields: KASBON_FIELDS,
			sort: 'tanggal_pengajuan',
			limit: '100'
		});
		const r = await directusServerJson<{ data: KasbonRecord[] }>(`/items/kasbon?${query.toString()}`);
		results.push(...(r?.data || []));
	}

	if (isHrd) {
		const batasEskalasi = new Date(Date.now() - 24 * 3600000).toISOString();
		const query = new URLSearchParams({
			'filter[status][_eq]': 'Diajukan',
			'filter[tanggal_pengajuan][_lte]': batasEskalasi,
			'filter[karyawan_id][_neq]': String(excludeKaryawanId),
			fields: KASBON_FIELDS,
			sort: 'tanggal_pengajuan',
			limit: '100'
		});
		const r = await directusServerJson<{ data: KasbonRecord[] }>(`/items/kasbon?${query.toString()}`);
		for (const item of r?.data || []) {
			if (!results.some((x) => x.id === item.id)) results.push(item);
		}
	}

	return results;
}

/** Riwayat approval: kasbon yang telah diproses (Disetujui / Ditolak / Lunas / dll) milik karyawan divisi/unit. */
export async function listHistoryKasbonForKepala(
	approverKaryawanId: number,
	approverDivisi: string | null,
	excludeKaryawanId: number
): Promise<KasbonRecord[]> {
	const targetIds = new Set(await listKaryawanIdsUnderKepala(approverKaryawanId, excludeKaryawanId));
	if (targetIds.size === 0) return [];

	const query = new URLSearchParams({
		'filter[karyawan_id][_in]': [...targetIds].join(','),
		'filter[status][_neq]': 'Diajukan',
		fields: KASBON_FIELDS,
		sort: '-tanggal_pengajuan',
		limit: '100'
	});
	const r = await directusServerJson<{ data: KasbonRecord[] }>(`/items/kasbon?${query.toString()}`);
	return r?.data || [];
}


interface KonfigurasiKasbon {
	plafonMultiplier: number;
	plafonPerStatusKerja: Record<string, number>;
	tenorMaxBulan: number;
	maxAktif: number;
	jedaHari: number;
}

/** Konfigurasi kasbon dari konfigurasi_payroll_rate (dikelola admin HRD) — fallback ke
 * keputusan default user Fase 3 (1x gaji, tenor 3 bulan, maks 1 kasbon aktif) bila kosong. */
export async function getKonfigurasiKasbon(): Promise<KonfigurasiKasbon> {
	try {
		const result = await directusServerJson<{ data: any[] }>(
			`/items/konfigurasi_payroll_rate?filter[key][_eq]=current&limit=1&fields=kasbon_plafon_multiplier,kasbon_plafon_per_status_kerja,kasbon_tenor_max_bulan,kasbon_max_aktif,kasbon_jeda_hari`
		);
		const cfg = result?.data?.[0];
		return {
			plafonMultiplier: Number(cfg?.kasbon_plafon_multiplier) || 1,
			plafonPerStatusKerja: cfg?.kasbon_plafon_per_status_kerja && typeof cfg.kasbon_plafon_per_status_kerja === 'object'
				? cfg.kasbon_plafon_per_status_kerja
				: {},
			tenorMaxBulan: Number(cfg?.kasbon_tenor_max_bulan) || 3,
			maxAktif: Number(cfg?.kasbon_max_aktif) || 1,
			jedaHari: Number(cfg?.kasbon_jeda_hari) || 30
		};
	} catch {
		return { plafonMultiplier: 1, plafonPerStatusKerja: {}, tenorMaxBulan: 3, maxAktif: 1, jedaHari: 30 };
	}
}

/** Fase 2 (Q9): blackout dua minggu terakhir Desember (tutup buku tahunan) — tidak boleh mengajukan
 * kasbon baru di rentang ini. */
function isDalamBlackoutDesember(now: Date): boolean {
	return now.getMonth() === 11 && now.getDate() >= 15; // getMonth() 0-based, 11 = Desember
}

/**
 * Fase 2 (Q1, T1): plafon nyata — sebelumnya plafon = gaji_pokok x multiplier, dan 190/192
 * karyawan punya gaji_pokok kosong/0 (gaji sebenarnya di identitas_gaji terenkripsi E2E),
 * sehingga plafon jadi 0 dan pengecekan DILEWATI (siapa pun bisa ajukan nominal berapa pun).
 * Sekarang: override per-orang (karyawan.plafon_kasbon) > tabel per status_kerja > fallback lama
 * (gaji_pokok x multiplier, untuk karyawan yang gaji_pokok-nya memang terisi).
 */
export function resolveEffectivePlafon(
	karyawan: { gaji_pokok?: number; status_kerja?: string | null; plafon_kasbon?: number | null },
	konfig: KonfigurasiKasbon
): number {
	if (Number(karyawan.plafon_kasbon) > 0) return Math.round(Number(karyawan.plafon_kasbon));

	const statusKerja = karyawan.status_kerja || '';
	const plafonStatus = konfig.plafonPerStatusKerja[statusKerja];
	if (plafonStatus !== undefined && plafonStatus !== null) return Math.round(Number(plafonStatus));
	if (konfig.plafonPerStatusKerja._default !== undefined) return Math.round(Number(konfig.plafonPerStatusKerja._default));

	const gajiPokok = Number(karyawan.gaji_pokok) || 0;
	return Math.round(gajiPokok * konfig.plafonMultiplier);
}

/**
 * Validasi server sebelum submit kasbon baru (S2 dokumen rencana — bukan hanya cek UI):
 * plafon nyata (T1), tenor <= tenor maks, jumlah kasbon aktif < maks (T12), jeda setelah lunas
 * (Q9), blackout tutup buku Desember (Q9).
 */
export async function assertKasbonEligible(
	karyawanId: number,
	nominal: number,
	tenor: number
): Promise<{ ok: true } | { ok: false; message: string }> {
	const [karyawanRes, konfig, existing] = await Promise.all([
		directusServerJson<{ data: { gaji_pokok: number; status_kerja: string | null; plafon_kasbon: number | null } }>(
			`/items/karyawan/${karyawanId}?fields=gaji_pokok,status_kerja,plafon_kasbon`
		),
		getKonfigurasiKasbon(),
		listKasbonByKaryawan(karyawanId)
	]);

	if (isDalamBlackoutDesember(new Date())) {
		return { ok: false, message: 'Pengajuan kasbon ditutup sementara (blackout tutup buku, 15-31 Desember). Silakan ajukan kembali awal Januari.' };
	}

	const plafon = resolveEffectivePlafon(karyawanRes?.data || {}, konfig);
	if (plafon > 0 && nominal > plafon) {
		return { ok: false, message: `Nominal melebihi plafon Rp${plafon.toLocaleString('id-ID')}.` };
	}
	if (tenor > konfig.tenorMaxBulan) {
		return { ok: false, message: `Tenor maksimal ${konfig.tenorMaxBulan} bulan.` };
	}

	const existingHidup = existing.filter((k) => !k.is_arsip_historis);
	const aktifCount = existingHidup.filter((k) => STATUS_AKTIF.includes(k.status) && k.payment_status !== 'lunas').length;
	if (aktifCount >= konfig.maxAktif) {
		return { ok: false, message: `Anda masih memiliki ${aktifCount} kasbon berjalan (maks ${konfig.maxAktif}). Lunasi dulu sebelum mengajukan baru.` };
	}

	// Q9: jeda N hari sejak kasbon TERAKHIR lunas (bukan sejak pengajuan) sebelum boleh ajukan lagi.
	const lunasTerakhir = existingHidup
		.filter((k) => k.payment_status === 'lunas' && k.last_payment_date)
		.sort((a, b) => String(b.last_payment_date).localeCompare(String(a.last_payment_date)))[0];
	if (lunasTerakhir?.last_payment_date) {
		const hariSejakLunas = Math.floor((Date.now() - new Date(lunasTerakhir.last_payment_date).getTime()) / 86400000);
		if (hariSejakLunas < konfig.jedaHari) {
			const sisaHari = konfig.jedaHari - hariSejakLunas;
			return { ok: false, message: `Kasbon terakhir baru lunas ${hariSejakLunas} hari lalu. Tunggu ${sisaHari} hari lagi sebelum mengajukan baru (jeda ${konfig.jedaHari} hari).` };
		}
	}

	return { ok: true };
}

export interface JadwalAngsuranBaris {
	periode: string; // 'YYYY-MM'
	urutan: number;
	nominal_rencana: number;
	status: 'terbayar' | 'proyeksi';
}

/**
 * Fase 4 (T10): proyeksi jadwal angsuran DIHITUNG ON-THE-FLY dari tanggal_mulai_potong +
 * cicilan_per_bulan + sisa nominal — bukan koleksi baru (sesuai opsi yang ditawarkan di
 * dokumen rencana). "terbayar" ditentukan dari urutan periode <= jumlah periode yang sudah
 * lewat sejak tanggal_mulai_potong, dibandingkan dengan total_paid aktual.
 */
export function computeJadwalAngsuran(kasbon: KasbonRecord): JadwalAngsuranBaris[] {
	if (!kasbon.tanggal_mulai_potong || !kasbon.cicilan_per_bulan) return [];
	const nominal = Number(kasbon.nominal) || 0;
	const cicilan = Number(kasbon.cicilan_per_bulan) || 0;
	if (cicilan <= 0 || nominal <= 0) return [];

	const totalPaid = Number(kasbon.total_paid) || 0;
	const jumlahPeriodeTerbayar = Math.floor(totalPaid / cicilan);
	const totalPeriode = Math.ceil(nominal / cicilan);

	const start = new Date(kasbon.tanggal_mulai_potong);
	const rows: JadwalAngsuranBaris[] = [];
	let sisa = nominal;
	for (let i = 0; i < totalPeriode; i++) {
		const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
		const periode = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
		const nominalRencana = Math.min(cicilan, sisa);
		rows.push({
			periode,
			urutan: i + 1,
			nominal_rencana: nominalRencana,
			status: i < jumlahPeriodeTerbayar ? 'terbayar' : 'proyeksi'
		});
		sisa -= nominalRencana;
		if (sisa <= 0) break;
	}
	return rows;
}

/** Fase 4 (R5): riwayat potongan aktual per periode (kartu hutang pribadi). */
export async function listKasbonPaymentLog(kasbonId: number) {
	const query = new URLSearchParams({
		'filter[kasbon_id][_eq]': String(kasbonId),
		fields: 'id,periode,nominal_potongan,tanggal',
		sort: '-tanggal',
		limit: '100'
	});
	const result = await directusServerJson<{ data: any[] }>(`/items/kasbon_payment_log?${query.toString()}`);
	return result?.data || [];
}
