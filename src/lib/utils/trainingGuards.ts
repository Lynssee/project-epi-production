// src/lib/utils/trainingGuards.ts
// Aturan murni LMS lapangan (tanpa akses Directus) — dipakai server (training.ts) DAN klien
// (TrainingPlayer) supaya hitungan waktu baca minimum identik di kedua sisi, dan mudah diuji.

/** Status enrollment yang tidak boleh diturunkan / ditimpa oleh pengerjaan ulang kuis atau progres modul. */
export const STATUS_ENROLLMENT_LULUS = 'Lulus';

export function isEnrollmentLulus(status: string | null | undefined): boolean {
	return status === STATUS_ENROLLMENT_LULUS;
}

/**
 * Kuis akhir (module_id kosong) tidak boleh dikerjakan ulang bila enrollment sudah Lulus —
 * hasil resmi (nilai_akhir, sertifikat) tidak boleh ditimpa. Kuis formatif per modul tetap boleh diulang.
 */
export function isFinalQuizRetakeBlocked(quiz: { module_id: number | null | undefined }, enrollmentStatus: string | null | undefined): boolean {
	return !quiz.module_id && isEnrollmentLulus(enrollmentStatus);
}

export const PESAN_KUIS_AKHIR_SUDAH_LULUS =
	'Anda sudah dinyatakan Lulus di kursus ini. Kuis akhir tidak perlu dikerjakan ulang — nilai dan sertifikat Anda tetap berlaku.';

/** Status enrollment hasil recompute progres modul; status 'Lulus' tidak pernah diturunkan. */
export function resolveEnrollmentStatusAfterRecompute(current: string | null | undefined, computed: string): string {
	return isEnrollmentLulus(current) ? STATUS_ENROLLMENT_LULUS : computed;
}

// ── Waktu baca minimum modul non-video (Teks/PDF/Link) + Video mode manual ─────

export interface ReadGateSettings {
	/** Saklar: false = perilaku lama (modul bisa ditandai selesai seketika). */
	aktif: boolean;
	/**
	 * Jenis konten yang dikunci. 'Video' hanya berlaku bila selesai ditandai MANUAL (pemutar YouTube
	 * gagal dimuat / video non-YouTube) — video yang terlacak punya mekanisme persen tonton sendiri.
	 */
	tipe: string[];
	/** Persen dari durasi_menit modul yang wajib dihabiskan (1-100). */
	persen: number;
	/** Batas atas waktu tunggu (detik) — agar teks dengan durasi besar tidak mengunci terlalu lama. */
	maksDetik: number;
}

export const READ_GATE_TIPE_VALID = ['Teks', 'PDF', 'Link', 'Video'] as const;

/** Default aman: 50% dari estimasi durasi, maksimal 5 menit. Modul tanpa durasi_menit tidak dikunci. */
export const READ_GATE_DEFAULTS: ReadGateSettings = { aktif: true, tipe: [...READ_GATE_TIPE_VALID], persen: 50, maksDetik: 300 };

/** Tipe konten yang selalu dilacak lewat waktu di halaman (bukan pemutar video). */
export function isReadTimeType(tipe: string | null | undefined): boolean {
	return tipe === 'Teks' || tipe === 'PDF' || tipe === 'Link';
}

/** Modul ini dilacak lewat waktu baca? (Video hanya bila selesai ditandai manual.) */
export function usesReadTime(tipe: string | null | undefined, manual: boolean): boolean {
	return isReadTimeType(tipe) || (tipe === 'Video' && manual);
}

/**
 * Detik baca minimum sebelum modul boleh ditandai selesai. 0 = tidak dikunci (saklar mati, jenis
 * konten tidak dipilih, video yang terlacak, atau durasi_menit kosong — termasuk modul lama).
 * manual: hanya relevan untuk Video (mode fallback tanpa pelacakan).
 */
export function computeMinReadSeconds(
	mod: { tipe_konten: string | null | undefined; durasi_menit: number | null | undefined },
	settings: ReadGateSettings = READ_GATE_DEFAULTS,
	opts: { manual?: boolean } = {}
): number {
	if (!settings.aktif) return 0;
	if (!usesReadTime(mod.tipe_konten, !!opts.manual)) return 0;
	if (!settings.tipe.includes(mod.tipe_konten as string)) return 0;
	const durasiMenit = Number(mod.durasi_menit);
	if (!Number.isFinite(durasiMenit) || durasiMenit <= 0) return 0;
	const target = Math.ceil(durasiMenit * 60 * (settings.persen / 100));
	return Math.max(0, Math.min(target, settings.maksDetik));
}

/** Sisa detik yang harus ditunggu (0 = boleh selesai). */
export function remainingReadSeconds(minDetik: number, detikDibaca: number | null | undefined): number {
	const dibaca = Number.isFinite(Number(detikDibaca)) ? Math.max(0, Number(detikDibaca)) : 0;
	return Math.max(0, Math.ceil(minDetik - dibaca));
}

/** "1:05" untuk hint hitung-mundur. */
export function formatCountdown(detik: number): string {
	const s = Math.max(0, Math.ceil(detik));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function asBool(v: unknown, fallback: boolean): boolean {
	if (v === true || v === 'true' || v === '1' || v === 1) return true;
	if (v === false || v === 'false' || v === '0' || v === 0) return false;
	return fallback;
}

function asIntInRange(v: unknown, min: number, max: number, fallback: number): number {
	const n = Number(v);
	return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback;
}

/** Daftar jenis konten dari app_settings: array JSON ('["Teks","PDF"]') atau CSV ('Teks,PDF'). Rusak → default. */
function asTipeList(v: unknown, fallback: string[]): string[] {
	let raw: unknown = v;
	if (typeof v === 'string') {
		const t = v.trim();
		if (t.startsWith('[')) {
			try {
				raw = JSON.parse(t);
			} catch {
				return fallback;
			}
		} else {
			raw = t === '' ? [] : t.split(',');
		}
	}
	if (!Array.isArray(raw)) return fallback;
	const valid = raw.map((x) => String(x).trim()).filter((x) => (READ_GATE_TIPE_VALID as readonly string[]).includes(x));
	// Daftar kosong sah (admin mengosongkan semua = tak ada jenis yang dikunci); isi tak dikenal semua → default.
	return raw.length === 0 || valid.length > 0 ? Array.from(new Set(valid)) : fallback;
}

/** Normalisasi baris app_settings module='training_lms' → ReadGateSettings (nilai rusak jatuh ke default). */
export function parseReadGateSettings(rows: Array<{ setting_key: string; setting_value: unknown }>): ReadGateSettings {
	const value: ReadGateSettings = { ...READ_GATE_DEFAULTS, tipe: [...READ_GATE_DEFAULTS.tipe] };
	for (const row of rows || []) {
		switch (row.setting_key) {
			case 'baca_min_aktif':
				value.aktif = asBool(row.setting_value, READ_GATE_DEFAULTS.aktif);
				break;
			case 'baca_min_tipe':
				value.tipe = asTipeList(row.setting_value, READ_GATE_DEFAULTS.tipe);
				break;
			case 'baca_min_persen':
				value.persen = asIntInRange(row.setting_value, 1, 100, READ_GATE_DEFAULTS.persen);
				break;
			case 'baca_min_detik_maks':
				value.maksDetik = asIntInRange(row.setting_value, 1, 3600, READ_GATE_DEFAULTS.maksDetik);
				break;
		}
	}
	return value;
}
