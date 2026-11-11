// src/lib/server/gates/securityKeyGate.ts
// G_SEC8 "Kepatuhan Serah-Terima Kunci" (Key Management). Evaluator MURNI (tanpa I/O).
// Mode (shadow/soft/hard) dibaca pemanggil lewat resolveGateMode('G_SEC8', 'security_lifecycle');
// ambang & saklar dari app_settings module='patrol_control' (patrolControlSettings.ts), bisa diatur
// superadmin di erp-epi /settings/patrol-control. Dua titik gigit:
//   1. Pinjam kunci (evaluateKeyBorrowGate)  — kunci terbatas di luar jam kerja / dibawa pulang.
//   2. Serah-terima shift (evaluateKeyHandoverGate) — masih ada kunci dipinjam tanpa dispensasi.

export interface KeyBorrowGateOptions {
	/** Jam WIB (0-23) jam kerja mulai (sama dengan G_SEC2). */
	jamKerjaMulai: number;
	/** Jam WIB (1-24, eksklusif) jam kerja selesai. */
	jamKerjaSelesai: number;
}

export type KeyViolationCode = 'KUNCI_TERBATAS_DILUAR_JAM' | 'KUNCI_DIBAWA_PULANG' | 'KUNCI_MASIH_DIPINJAM' | 'KUNCI_BELUM_DICEK';

export interface KeyViolation {
	code: KeyViolationCode;
	message: string;
}

export interface KeyGateResult {
	passed: boolean;
	violations: KeyViolation[];
	summary: string;
}

function build(violations: KeyViolation[], okSummary: string): KeyGateResult {
	return {
		passed: violations.length === 0,
		violations,
		summary: violations.length === 0 ? okSummary : violations.map((v) => v.message).join('; ')
	};
}

/** Jam (0-23) dan tanggal (YYYY-MM-DD) menurut WIB dari sebuah instan. */
export function jakartaParts(at: Date): { hour: number; date: string } {
	const shifted = new Date(at.getTime() + 7 * 3600_000);
	return { hour: shifted.getUTCHours(), date: shifted.toISOString().slice(0, 10) };
}

export function isDalamJamKerja(hour: number, mulai: number, selesai: number): boolean {
	return hour >= mulai && hour < selesai;
}

export interface KeyDispensation {
	alasanCukup: boolean;
	/** izin atasan diberikan oleh atasan langsung/fungsional peminjam dan fitur aktif */
	izinAtasanValid: boolean;
	/** izin atasan diberikan tetapi pemberinya bukan atasan peminjam (atau fitur nonaktif) */
	izinAtasanDitolak: boolean;
	dispensasi: boolean;
}

/**
 * Apakah pelanggaran peminjaman punya dispensasi: alasan cukup panjang ATAU izin dari atasan peminjam.
 * `atasanIds` = atasan langsung + fungsional peminjam (boleh null/undefined).
 */
export function resolveKeyDispensation(input: {
	reason: string | null | undefined;
	minAlasan: number;
	izinAtasanId: number | null | undefined;
	atasanIds: Array<number | null | undefined>;
	izinAtasanAktif: boolean;
}): KeyDispensation {
	const alasanCukup = (input.reason ?? '').trim().length >= Math.max(0, input.minAlasan);
	const diberi = Number.isInteger(input.izinAtasanId) && (input.izinAtasanId as number) > 0;
	const sahAtasan = diberi && input.atasanIds.some((a) => a != null && a === input.izinAtasanId);
	const izinAtasanValid = input.izinAtasanAktif && sahAtasan;
	return {
		alasanCukup,
		izinAtasanValid,
		izinAtasanDitolak: diberi && !izinAtasanValid,
		dispensasi: alasanCukup || izinAtasanValid
	};
}

const MAKS_PINJAM_JAM = 72;

/**
 * Tentukan batas kembali kunci.
 * - `diminta` (ISO dari klien) bila ada: harus tanggal valid, di masa depan, dan maksimal 72 jam ke depan.
 * - Tanpa `diminta`: hari ini pukul `jamDefault` WIB (24 = 23:59); bila sudah lewat → 2 jam dari sekarang.
 * `bawaPulang` = batas kembali jatuh di tanggal WIB yang berbeda dari tanggal ambil.
 */
export function hitungRencanaKembali(input: {
	now: Date;
	jamDefault: number;
	diminta?: string | null;
}): { rencana: Date; bawaPulang: boolean; error?: string } {
	const { now } = input;
	let rencana: Date;
	if (input.diminta) {
		rencana = new Date(input.diminta);
		if (Number.isNaN(rencana.getTime())) return { rencana: now, bawaPulang: false, error: 'Batas kembali tidak valid.' };
		if (rencana.getTime() <= now.getTime()) return { rencana, bawaPulang: false, error: 'Batas kembali harus di masa depan.' };
		if (rencana.getTime() - now.getTime() > MAKS_PINJAM_JAM * 3600_000) {
			return { rencana, bawaPulang: false, error: `Batas kembali maksimal ${MAKS_PINJAM_JAM} jam dari sekarang.` };
		}
	} else {
		const { date } = jakartaParts(now);
		const midnightWibUtc = Date.parse(`${date}T00:00:00Z`) - 7 * 3600_000;
		const jam = Math.min(Math.max(Math.trunc(input.jamDefault) || 17, 1), 24);
		rencana = new Date(midnightWibUtc + jam * 3600_000 - (jam >= 24 ? 60_000 : 0));
		if (rencana.getTime() <= now.getTime()) rencana = new Date(now.getTime() + 2 * 3600_000);
	}
	return { rencana, bawaPulang: jakartaParts(rencana).date !== jakartaParts(now).date };
}

/** Terlambat = sudah melewati batas kembali + tenggang (menit). Batas kosong/tidak valid → tidak terlambat. */
export function isKunciTerlambat(rencanaKembali: string | Date | null | undefined, now: Date, tenggangMenit: number): boolean {
	if (!rencanaKembali) return false;
	const t = new Date(rencanaKembali).getTime();
	if (Number.isNaN(t)) return false;
	return now.getTime() > t + Math.max(0, tenggangMenit || 0) * 60_000;
}

/**
 * Evaluasi peminjaman satu kunci.
 * @param bawaPulang true bila batas kembali jatuh di hari WIB berbeda dari waktu ambil (kunci menginap).
 */
export function evaluateKeyBorrowGate(input: {
	namaKunci: string;
	isRestricted: boolean;
	now: Date;
	bawaPulang: boolean;
	options: KeyBorrowGateOptions;
}): KeyGateResult {
	const violations: KeyViolation[] = [];
	const { hour } = jakartaParts(input.now);
	const nama = input.namaKunci || 'kunci';

	if (input.isRestricted && !isDalamJamKerja(hour, input.options.jamKerjaMulai, input.options.jamKerjaSelesai)) {
		violations.push({
			code: 'KUNCI_TERBATAS_DILUAR_JAM',
			message: `${nama} adalah kunci terbatas dan diambil di luar jam kerja (${input.options.jamKerjaMulai}:00-${input.options.jamKerjaSelesai}:00 WIB)`
		});
	}
	if (input.bawaPulang) {
		violations.push({
			code: 'KUNCI_DIBAWA_PULANG',
			message: `${nama} direncanakan dibawa pulang (batas kembali di hari berikutnya)`
		});
	}
	return build(violations, 'Peminjaman kunci sesuai aturan.');
}

export interface KeyOutstanding {
	kode: string;
	nama: string;
	/** status key_master: 'dipinjam' | 'overnight_ijin' | dst. */
	status: string;
}

/**
 * Evaluasi serah-terima shift terhadap kunci yang belum kembali.
 * Kunci berstatus overnight_ijin (dispensasi bawa pulang sudah disetujui) tidak dihitung.
 * @param outstanding null = tidak diketahui (gagal baca) → lolos (fail-open, dicatat pemanggil).
 */
export function evaluateKeyHandoverGate(input: {
	outstanding: KeyOutstanding[] | null | undefined;
	/**
	 * Kunci yang tercatat di slot tetapi belum dicentang satpam saat serah-terima. Diisi pemanggil HANYA bila
	 * aturan "wajib cek fisik" aktif; null/undefined/kosong = tidak dievaluasi.
	 */
	belumDicek?: KeyOutstanding[] | null;
}): KeyGateResult {
	if (!input.outstanding) return build([], 'Rekonsiliasi kunci dilewati (data tidak tersedia).');
	const violations: KeyViolation[] = [];
	const belumKembali = input.outstanding.filter((k) => k.status === 'dipinjam');
	const ringkas = (rows: KeyOutstanding[]) => {
		const daftar = rows
			.slice(0, 5)
			.map((k) => `${k.kode} ${k.nama}`.trim())
			.join(', ');
		return `${daftar}${rows.length > 5 ? ` dan ${rows.length - 5} lainnya` : ''}`;
	};
	if (belumKembali.length > 0) {
		violations.push({ code: 'KUNCI_MASIH_DIPINJAM', message: `${belumKembali.length} kunci belum kembali ke slot: ${ringkas(belumKembali)}` });
	}
	const belumDicek = input.belumDicek ?? [];
	if (belumDicek.length > 0) {
		violations.push({ code: 'KUNCI_BELUM_DICEK', message: `${belumDicek.length} kunci di slot belum dicek fisik: ${ringkas(belumDicek)}` });
	}
	return build(violations, 'Semua kunci operasional sudah kembali ke slotnya.');
}
