// src/lib/server/visitGate.ts
// "4-Gate Site Visit System" Fase 3b (8 Sep 2026) — port TypeScript dari erp-epi
// (src/lib/server/gates/visitGate.js) untuk sisi lapangan (project-epi). Sama Directus,
// jadi query langsung /items/site_checkin aman (project-epi adalah SUMBER site_checkin).
//
// Dipakai di sini untuk G_RMR_VISIT (ess/reimburse) dan G_BBM_VISIT (biaya-lapangan) —
// endpoint yang membuat record LANGSUNG tanpa preflight terpisah, jadi hard-block di sini
// ADALAH titik penegakannya (beda dari erp-epi PA yang lewat validate/+server.js dulu).

import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';

const MIN_EXCEPTION_LENGTH = 20;
// Paket 06 §2.6 — kategori terstruktur (klien mengirim "{kategori}: {keterangan}" atau
// "{kategori}" polos untuk selain "Lainnya"). Daftar disalin dari klien (ess/reimburse/baru,
// biaya-lapangan) — sengaja duplikat literal (bukan import lintas client/server) supaya
// modul ini tidak bergantung pada kode UI.
const KATEGORI_ALASAN_VALID = [
	'Perjalanan ke kantor cabang/instansi (bukan proyek/customer)',
	'Antar/jemput barang atau dokumen',
	'Lupa check-in di lokasi',
	'HP bermasalah / tidak ada sinyal saat di lokasi',
	'Lainnya (tulis)'
];
// String berulang (mis. "aaaaaaaaaaaaaaaaaaaa") — orang awam mengetik asal supaya gate
// lolos tanpa makna. 1 karakter diulang >=10x berturut-turut dianggap spam.
const POLA_SPAM = /(.)\1{9,}/;
const DEFAULT_MIN_DURASI_FINANSIAL = 30;
// Paket 06 Site Visit Release §2.1 — default dipakai HANYA bila baris settings tidak
// terbaca sama sekali (fail-soft Directus down); nilai nyata datang dari kolom Directus.
const DEFAULT_MAKS_SELISIH_HARI_KLAIM = 7;
const DEFAULT_VISIT_PICKER_HARI = 30;

interface VisitSettings {
	visit_gate_aktif: boolean;
	min_durasi_menit_finansial: number;
	// Paket 06 §2.1 — klaim boleh diajukan paling lambat sekian hari SETELAH kunjungan
	// (jendela mundur). Beda dari batas "kunjungan belum terjadi" (selalu 1 hari ke depan,
	// lihat validasiKepemilikanDanWaktu — perjalanan lintas hari, bukan dikonfigurasi admin).
	maks_selisih_hari_klaim: number;
	// Paket 06 §2.4 — rentang hari picker kunjungan (dibaca klien lewat /api/site-checkin/settings).
	visit_picker_hari: number;
}

// SV-05: site_checkin_settings.visit_gate_aktif belum di-cast-boolean — SQLite Directus
// mengembalikan 0/1 mentah. `0 !== false` bernilai true, jadi kill-switch TIDAK PERNAH bisa
// dimatikan HRD/Admin. Normalisasi 0/1/'0'/'1'/true/false sebelum dibandingkan.
function asBool(v: unknown, fallback: boolean): boolean {
	if (v === true || v === 1 || v === '1' || v === 'true') return true;
	if (v === false || v === 0 || v === '0' || v === 'false') return false;
	return fallback;
}

let settingsCache: { at: number; data: VisitSettings | null } = { at: 0, data: null };
const SETTINGS_TTL_MS = 5 * 60 * 1000;

// Diekspor supaya /api/site-checkin/settings bisa meneruskan visit_picker_hari/
// maks_selisih_hari_klaim ke klien (Paket 06 §2.4) tanpa query Directus terpisah.
export async function readVisitSettings(): Promise<VisitSettings> {
	const now = Date.now();
	if (settingsCache.data && now - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.data;
	const res = await directusServerJson<{
		data: {
			visit_gate_aktif: boolean;
			min_durasi_menit_finansial: number;
			maks_selisih_hari_klaim: number;
			visit_picker_hari: number;
		};
	}>('/items/site_checkin_settings?fields=visit_gate_aktif,min_durasi_menit_finansial,maks_selisih_hari_klaim,visit_picker_hari').catch(
		() => null
	);
	const data: VisitSettings = {
		visit_gate_aktif: asBool(res?.data?.visit_gate_aktif, true),
		min_durasi_menit_finansial: Number.isFinite(Number(res?.data?.min_durasi_menit_finansial))
			? Number(res?.data?.min_durasi_menit_finansial)
			: DEFAULT_MIN_DURASI_FINANSIAL,
		maks_selisih_hari_klaim: Number.isFinite(Number(res?.data?.maks_selisih_hari_klaim))
			? Number(res?.data?.maks_selisih_hari_klaim)
			: DEFAULT_MAKS_SELISIH_HARI_KLAIM,
		visit_picker_hari: Number.isFinite(Number(res?.data?.visit_picker_hari))
			? Number(res?.data?.visit_picker_hari)
			: DEFAULT_VISIT_PICKER_HARI
	};
	settingsCache = { at: now, data };
	return data;
}

interface CheckinRow {
	id: string;
	status: string;
	nama_lokasi: string | null;
	karyawan_id: string;
	check_in_at: string;
	durasi_menit: number | null;
}

async function fetchSiteCheckin(siteCheckinId: string | null): Promise<CheckinRow | null> {
	if (!siteCheckinId) return null;
	const res = await directusServerJson<{ data: CheckinRow }>(
		`/items/site_checkin/${siteCheckinId}?fields=id,status,nama_lokasi,karyawan_id,check_in_at,durasi_menit`
	).catch(() => null);
	return res?.data || null;
}

function tanggalKeUtcMidnight(s: string): number {
	const [y, m, d] = s.split('-').map(Number);
	return Date.UTC(y, m - 1, d);
}

/** Selisih hari kalender (bukan jam) antara dua tanggal WIB 'YYYY-MM-DD'. */
function selisihHariKalender(a: string, b: string): number {
	return Math.round(Math.abs(tanggalKeUtcMidnight(a) - tanggalKeUtcMidnight(b)) / (24 * 3600 * 1000));
}

/** Positif bila tanggalKlaim SETELAH tglKunjungan (kasus normal: klaim menyusul kunjungan).
 *  Negatif bila tanggalKlaim SEBELUM tglKunjungan (kunjungan belum terjadi saat klaim diajukan). */
function selisihHariBertanda(tglKunjungan: string, tanggalKlaim: string): number {
	return Math.round((tanggalKeUtcMidnight(tanggalKlaim) - tanggalKeUtcMidnight(tglKunjungan)) / (24 * 3600 * 1000));
}

/**
 * SV-13 (correction plan site-visit-payroll): samakan kekuatan gate lapangan dengan versi
 * admin (erp-epi gates/visitGate.js sudah punya G_VISIT_STATUS/G_VISIT_DURATION). Sebelumnya
 * checkRmrVisitGate/checkBbmVisitGate di sini cuma cek "ID kunjungan ada" — kunjungan ORANG
 * LAIN, tanggal berbeda, atau durasi 1 menit bisa dipakai klaim finansial.
 */
async function validasiKepemilikanDanWaktu(
	checkin: CheckinRow,
	karyawanId: string | null | undefined,
	tanggalKlaim: string | null | undefined,
	minDurasiMenit: number,
	maksSelisihHariKlaim: number
): Promise<GateResult | null> {
	if (karyawanId && checkin.karyawan_id !== karyawanId) {
		return { allowed: false, reason: 'Kunjungan ini tercatat atas nama karyawan lain, bukan Anda' };
	}
	if (tanggalKlaim) {
		// Paket 06 §2.2 — jendela ASIMETRIS, bukan +-1 hari simetris lama:
		//   - kunjungan SETELAH tanggal klaim (>1 hari) -> tidak mungkin, klaim mendahului
		//     kejadian -> tolak (bukan soal konfigurasi admin, selalu 1 hari — perjalanan
		//     lintas hari WIB/UTC wajar, lebih dari itu berarti data keliru).
		//   - kunjungan SEBELUM tanggal klaim lebih dari maksSelisihHariKlaim hari -> klaim
		//     terlambat, tolak dengan pesan awam yang bisa ditindaklanjuti.
		const tglKunjungan = todayJakarta(new Date(checkin.check_in_at));
		const selisih = selisihHariBertanda(tglKunjungan, tanggalKlaim); // positif = klaim setelah kunjungan
		if (selisih < -1) {
			return {
				allowed: false,
				reason: `Kunjungan tanggal ${tglKunjungan} belum terjadi pada tanggal klaim ${tanggalKlaim}`
			};
		}
		if (selisih > maksSelisihHariKlaim) {
			return {
				allowed: false,
				reason: `Kunjungan tanggal ${tglKunjungan} sudah lebih dari ${maksSelisihHariKlaim} hari. Ajukan klaim paling lambat ${maksSelisihHariKlaim} hari setelah kunjungan, atau isi alasan.`
			};
		}
	}
	const durasi = checkin.durasi_menit;
	if (!Number.isFinite(durasi)) {
		return { allowed: false, reason: `Kunjungan "${checkin.nama_lokasi || checkin.id}" belum punya durasi tercatat (belum checkout?)` };
	}
	if ((durasi as number) < minDurasiMenit) {
		return { allowed: false, reason: `Durasi kunjungan ${durasi} menit — di bawah minimum ${minDurasiMenit} menit untuk klaim finansial` };
	}
	return null; // lolos semua validasi tambahan
}

export interface GateResult {
	allowed: boolean;
	reason: string;
}

/**
 * G_RMR_VISIT: reimbursement kategori Transport/Perjalanan Dinas wajib terkait
 * site_checkin_id, ATAU visit_exception (≥20 karakter) untuk kasus non-kunjungan-site.
 */
export async function checkRmrVisitGate(
	siteCheckinId: string | null,
	visitException: string | null,
	karyawanId?: string | null,
	tanggalKlaim?: string | null // YYYY-MM-DD WIB — tanggal transaksi/klaim reimburse
): Promise<GateResult> {
	const settings = await readVisitSettings();
	if (!settings.visit_gate_aktif) return { allowed: true, reason: 'N/A — gate visit dinonaktifkan' };

	if (siteCheckinId) {
		const checkin = await fetchSiteCheckin(siteCheckinId);
		if (!checkin) return { allowed: false, reason: `Kunjungan #${siteCheckinId} tidak ditemukan` };
		if (checkin.status === 'active') {
			// Paket 06 §2.2 — pesan bisa ditindaklanjuti (masih gagal gate, bukan diloloskan).
			return {
				allowed: false,
				reason: `Kunjungan "${checkin.nama_lokasi || siteCheckinId}" belum di-check-out. Buka Site Check-in → Check-out dulu.`
			};
		}
		if (checkin.status !== 'completed') {
			return { allowed: false, reason: `Kunjungan "${checkin.nama_lokasi || siteCheckinId}" berstatus '${checkin.status}' — tidak valid untuk klaim` };
		}
		const gagal = await validasiKepemilikanDanWaktu(
			checkin,
			karyawanId,
			tanggalKlaim,
			settings.min_durasi_menit_finansial,
			settings.maks_selisih_hari_klaim
		);
		if (gagal) return gagal;
		return { allowed: true, reason: `Terkait kunjungan "${checkin.nama_lokasi || siteCheckinId}"` };
	}

	const reason = (visitException || '').trim();
	if (reason.length === 0) {
		return {
			allowed: false,
			reason: 'Belum memilih kunjungan terkait — pilih dari daftar, atau isi alasan pengecualian'
		};
	}
	// Paket 06 §2.6 — kategori wajib dikenali (klien selalu mengirim salah satu dari
	// KATEGORI_ALASAN_VALID sebagai awalan); tolak string bebas yang lolos dari UI lama/
	// klien pihak ketiga. Untuk "Lainnya" wajib ada keterangan SETELAH ": " dan bukan spam.
	// Dicocokkan tanpa spasi wajib setelah ":" — reason SUDAH di-trim() di atas, jadi
	// "Lainnya (tulis): " (keterangan kosong) berakhir sebagai "Lainnya (tulis):" (spasi
	// tunggal ikut terbuang trim), bukan lagi diikuti spasi.
	const kategoriCocok = KATEGORI_ALASAN_VALID.find((k) => reason === k || reason.startsWith(`${k}:`));
	if (!kategoriCocok) {
		return { allowed: false, reason: 'Alasan pengecualian tidak dikenali — pilih dari daftar kategori yang tersedia' };
	}
	if (kategoriCocok === 'Lainnya (tulis)') {
		const keterangan = reason.slice(kategoriCocok.length).replace(/^:\s*/, '').trim(); // buang "Lainnya (tulis):"
		if (keterangan.length < 10) {
			return { allowed: false, reason: 'Keterangan "Lainnya" masih terlalu pendek — minimal 10 karakter' };
		}
		if (POLA_SPAM.test(keterangan)) {
			return { allowed: false, reason: 'Keterangan tampak berupa karakter berulang, bukan penjelasan — tulis alasan sebenarnya' };
		}
	}
	if (reason.length < MIN_EXCEPTION_LENGTH && kategoriCocok !== 'Lainnya (tulis)') {
		// Semua kategori tetap punya isi bermakna sejak awal (nama kategori itu sendiri) —
		// jalur ini praktis tidak pernah tercapai kecuali daftar kategori diubah jadi lebih
		// pendek dari 20 karakter di masa depan; dipertahankan sebagai jaring pengaman.
		return { allowed: false, reason: `Alasan pengecualian terlalu pendek — minimal ${MIN_EXCEPTION_LENGTH} karakter` };
	}
	return { allowed: true, reason: `Tanpa kunjungan fisik — alasan: ${kategoriCocok}` };
}

/**
 * G_BBM_VISIT: pencatatan BBM/Tol/Parkir wajib terkait site_checkin aktif/selesai, ATAU
 * trip_log_id (peminjaman kendaraan tercatat).
 */
export async function checkBbmVisitGate(
	siteCheckinId: string | null,
	tripLogId: string | null,
	karyawanId?: string | null,
	tanggalKlaim?: string | null // YYYY-MM-DD WIB — tanggal pencatatan BBM/Tol/Parkir
): Promise<GateResult> {
	const settings = await readVisitSettings();
	if (!settings.visit_gate_aktif) return { allowed: true, reason: 'N/A — gate visit dinonaktifkan' };

	if (tripLogId) {
		return { allowed: true, reason: `Tercatat lewat peminjaman kendaraan (trip_log #${tripLogId})` };
	}
	if (!siteCheckinId) {
		return {
			allowed: false,
			reason: 'Tidak ada site visit aktif/terkait maupun peminjaman kendaraan tercatat — lakukan check-in site terlebih dahulu'
		};
	}
	const checkin = await fetchSiteCheckin(siteCheckinId);
	if (!checkin) return { allowed: false, reason: `Kunjungan #${siteCheckinId} tidak ditemukan` };
	if (!['active', 'completed'].includes(checkin.status)) {
		return { allowed: false, reason: `Kunjungan "${checkin.nama_lokasi || siteCheckinId}" berstatus '${checkin.status}' — bukan kunjungan aktif/selesai yang valid` };
	}
	if (karyawanId && checkin.karyawan_id !== karyawanId) {
		return { allowed: false, reason: 'Kunjungan ini tercatat atas nama karyawan lain, bukan Anda' };
	}
	// BBM/Tol/Parkir dari kunjungan AKTIF (belum checkout) belum punya durasi_menit — wajar,
	// jangan tolak; validasi durasi hanya berlaku begitu kunjungan sudah 'completed'.
	if (checkin.status === 'completed') {
		const gagal = await validasiKepemilikanDanWaktu(
			checkin,
			karyawanId,
			tanggalKlaim,
			settings.min_durasi_menit_finansial,
			settings.maks_selisih_hari_klaim
		);
		if (gagal) return gagal;
	} else if (tanggalKlaim) {
		const tglKunjungan = todayJakarta(new Date(checkin.check_in_at));
		if (selisihHariKalender(tglKunjungan, tanggalKlaim) > 1) {
			return { allowed: false, reason: `Tanggal kunjungan (${tglKunjungan}) berbeda dari tanggal pencatatan (${tanggalKlaim})` };
		}
	}
	return { allowed: true, reason: `Terkait kunjungan "${checkin.nama_lokasi || siteCheckinId}" (${checkin.status})` };
}
