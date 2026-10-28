// src/lib/server/ess/istirahatMobileContext.ts
// Rencana Absensi Istirahat v2, Fase 2 §3.2 — konteks lokasi & kualitas bukti utk karyawan
// pola kerja MOBILE saat absen kembali dari istirahat lewat ESS (bukan kiosk). Biaya nol:
// reuse lokasi_absensi + site_checkin yang sudah ada, TIDAK ada koleksi/kolom baru.
//
// hitungKonteksLokasi() dan hitungKualitasBukti() adalah fungsi MURNI (tanpa I/O) — mudah
// diuji unit. gatherMobileKonteksKualitas() adalah wrapper impure yang mengumpulkan data lalu
// memanggil keduanya; dipanggil dari break-in/+server.ts hanya utk karyawan pola_kerja='mobile'.
//
// Catatan keterbatasan (dicatat, bukan diselesaikan diam-diam): deteksi foto_hash duplikat
// (§3.2 tabel pengurang skor) BELUM diwireup — absensi_istirahat_log tidak punya kolom
// foto_hash (beda dari site_checkin yang sudah punya). Menambah kolom itu di luar cakupan
// "biaya nol" Fase 2; fungsi hitungKualitasBukti() sudah menerima parameternya, wrapper
// selalu mengirim `false` untuk sekarang.
//
// Tipe 'customer' TIDAK auto-terdeteksi — site_checkin.tipe_checkin di data nyata hanya
// berisi 'proyek'/'peminjaman_kendaraan', tidak ada 'customer' (dikonfirmasi audit langsung
// ke kode siteCheckin.ts). Karyawan tetap bisa mengoreksi konteks jadi 'customer' manual di
// ESS (konteks_sumber='deklarasi'), tapi tidak ada sinyal server otomatis untuk itu.

import { directusServerJson } from '$lib/server/directus';
import { withinRadius } from '$lib/server/ess/geo';
import { getActiveCheckin } from '$lib/server/siteCheckin';

export type KonteksLokasi = 'kantor' | 'site_proyek' | 'customer' | 'perjalanan' | 'luar_area';
export type KonteksSumber = 'auto' | 'deklarasi';
export type KualitasLabel = 'TERVERIFIKASI' | 'TERKONFIRMASI DEKLARASI' | 'BUKTI LEMAH';

const SKOR_DASAR: Record<KonteksLokasi, number> = {
	kantor: 100,
	site_proyek: 95,
	customer: 85,
	perjalanan: 55,
	luar_area: 40
};

export interface HitungKonteksLokasiParams {
	dalamRadiusKantor: boolean;
	dalamRadiusSiteProyek: boolean;
	adaSiteCheckinAktifProyek: boolean;
	declaredPerjalanan: boolean; // karyawan menyatakan "sedang di jalan" (tanpa geofence cocok)
}

/** Klasifikasi konteks lokasi — urut dari sinyal terkuat, lihat rencana v2 §3.2 tabel. */
export function hitungKonteksLokasi(p: HitungKonteksLokasiParams): { konteksLokasi: KonteksLokasi; konteksSumber: KonteksSumber } {
	if (p.dalamRadiusKantor) return { konteksLokasi: 'kantor', konteksSumber: 'auto' };
	if (p.dalamRadiusSiteProyek || p.adaSiteCheckinAktifProyek) return { konteksLokasi: 'site_proyek', konteksSumber: 'auto' };
	if (p.declaredPerjalanan) return { konteksLokasi: 'perjalanan', konteksSumber: 'deklarasi' };
	return { konteksLokasi: 'luar_area', konteksSumber: 'auto' };
}

export interface HitungKualitasBuktiParams {
	konteksLokasi: KonteksLokasi;
	akurasiGpsM: number | null;
	antiFakeGpsScore: number; // 0-1, dari computeAntiFakeGpsScore()
	fotoWajib: boolean;
	fotoDiambil: boolean;
	fotoDitunda: boolean; // mode "istirahat di perjalanan" — foto ditunda TIDAK dihukum
	fotoHashDuplikat: boolean; // lihat catatan keterbatasan di atas — selalu false utk sekarang
	ambangRendah?: number; // konfigurasi_kebijakan_disiplin.istirahat_ambang_kualitas_rendah, default 50
}

/** Skor 0-100 + label — TIDAK PERNAH memblokir, hanya mengklasifikasi kualitas bukti. */
export function hitungKualitasBukti(p: HitungKualitasBuktiParams): { skor: number; label: KualitasLabel } {
	let skor = SKOR_DASAR[p.konteksLokasi];

	if (p.akurasiGpsM != null && p.akurasiGpsM > 100) skor -= 20;
	if (p.antiFakeGpsScore < 0.5) skor -= 40;
	if (p.fotoWajib && !p.fotoDiambil && !p.fotoDitunda) skor -= 15;
	if (p.fotoHashDuplikat) skor -= 50;

	skor = Math.max(0, Math.min(100, skor));
	const ambangRendah = p.ambangRendah ?? 50;
	const label: KualitasLabel = skor >= 80 ? 'TERVERIFIKASI' : skor >= ambangRendah ? 'TERKONFIRMASI DEKLARASI' : 'BUKTI LEMAH';
	return { skor, label };
}

export interface GatherMobileKonteksKualitasParams {
	karyawanId: number;
	lat: number;
	lng: number;
	akurasiGpsM: number | null;
	antiFakeGpsScore: number;
	fotoWajib: boolean;
	fotoDiambil: boolean;
	declaredPerjalanan: boolean;
	fotoDitunda: boolean;
	ambangRendah?: number;
	// Chip konteks otomatis + tombol koreksi (rencana v2 §5 Fase 2): karyawan bisa mengoreksi
	// konteks yang salah deteksi SEBELUM submit (lihat /api/ess/attendance/konteks-preview).
	// Bila terisi, deteksi geofence/site_checkin dilewati — konteks dipaksa ke pilihan karyawan
	// dengan konteks_sumber='deklarasi'.
	konteksOverride?: KonteksLokasi | null;
}

async function detectKonteksSinyal(karyawanId: number, lat: number, lng: number) {
	const lokasiRes = await directusServerJson<{ data: { id: string; lat: number; lng: number; radius_m: number; proyek_id: number | null }[] }>(
		`/items/lokasi_absensi?filter[aktif][_eq]=true&fields=id,lat,lng,radius_m,proyek_id&limit=-1`
	);
	const semuaLokasi = lokasiRes?.data || [];
	const lokasiKantor = semuaLokasi.filter((l) => !l.proyek_id);
	const lokasiSite = semuaLokasi.filter((l) => l.proyek_id);

	const dalamRadiusKantor = lokasiKantor.some((l) => withinRadius(lat, lng, l.lat, l.lng, l.radius_m).valid);
	const dalamRadiusSiteProyek = lokasiSite.some((l) => withinRadius(lat, lng, l.lat, l.lng, l.radius_m).valid);

	let siteCheckinId: string | null = null;
	let adaSiteCheckinAktifProyek = false;
	try {
		const activeCheckin = await getActiveCheckin(String(karyawanId));
		const validSiteTypes = ['proyek', 'peminjaman_kendaraan', 'marketing', 'maintenance'];
		if (activeCheckin && validSiteTypes.includes(activeCheckin.tipe_checkin)) {
			adaSiteCheckinAktifProyek = true;
			siteCheckinId = activeCheckin.id;
		}
	} catch {
		/* site_checkin hanya konteks tambahan — gagal-lunak, tidak boleh memblokir absen */
	}

	return { dalamRadiusKantor, dalamRadiusSiteProyek, adaSiteCheckinAktifProyek, siteCheckinId };
}

/**
 * Pratinjau konteks lokasi SEBELUM submit (chip otomatis) — dipanggil dari
 * /api/ess/attendance/konteks-preview begitu GPS didapat, supaya karyawan bisa mengoreksi
 * lewat tombol "Ubah lokasi" sebelum absen benar-benar terkirim. Hanya klasifikasi lokasi,
 * TIDAK menghitung skor kualitas (itu butuh info foto yang belum ada di tahap ini).
 */
export async function previewKonteksLokasi(karyawanId: number, lat: number, lng: number): Promise<{ konteksLokasi: KonteksLokasi; konteksSumber: KonteksSumber }> {
	const { dalamRadiusKantor, dalamRadiusSiteProyek, adaSiteCheckinAktifProyek } = await detectKonteksSinyal(karyawanId, lat, lng);
	return hitungKonteksLokasi({ dalamRadiusKantor, dalamRadiusSiteProyek, adaSiteCheckinAktifProyek, declaredPerjalanan: false });
}

export interface MobileKonteksKualitasResult {
	konteksLokasi: KonteksLokasi;
	konteksSumber: KonteksSumber;
	kualitasBukti: number;
	kualitasLabel: KualitasLabel;
	siteCheckinId: string | null;
}

/** Kumpulkan sinyal (lokasi_absensi + site_checkin aktif) lalu hitung — dipanggil break-in. */
export async function gatherMobileKonteksKualitas(p: GatherMobileKonteksKualitasParams): Promise<MobileKonteksKualitasResult> {
	let konteksLokasi: KonteksLokasi;
	let konteksSumber: KonteksSumber;
	let siteCheckinId: string | null = null;

	if (p.konteksOverride) {
		// Karyawan mengoreksi lewat tombol "Ubah lokasi" sebelum submit — pakai pilihannya
		// langsung, lewati deteksi geofence/site_checkin.
		konteksLokasi = p.konteksOverride;
		konteksSumber = 'deklarasi';
	} else {
		const sinyal = await detectKonteksSinyal(p.karyawanId, p.lat, p.lng);
		siteCheckinId = sinyal.siteCheckinId;
		const hasil = hitungKonteksLokasi({
			dalamRadiusKantor: sinyal.dalamRadiusKantor,
			dalamRadiusSiteProyek: sinyal.dalamRadiusSiteProyek,
			adaSiteCheckinAktifProyek: sinyal.adaSiteCheckinAktifProyek,
			declaredPerjalanan: p.declaredPerjalanan
		});
		konteksLokasi = hasil.konteksLokasi;
		konteksSumber = hasil.konteksSumber;
	}

	const { skor, label } = hitungKualitasBukti({
		konteksLokasi,
		akurasiGpsM: p.akurasiGpsM,
		antiFakeGpsScore: p.antiFakeGpsScore,
		fotoWajib: p.fotoWajib,
		fotoDiambil: p.fotoDiambil,
		fotoDitunda: p.fotoDitunda,
		fotoHashDuplikat: false, // lihat catatan keterbatasan di header file
		ambangRendah: p.ambangRendah
	});

	return {
		konteksLokasi,
		konteksSumber,
		kualitasBukti: skor,
		kualitasLabel: label,
		siteCheckinId: konteksLokasi === 'site_proyek' ? siteCheckinId : null
	};
}
