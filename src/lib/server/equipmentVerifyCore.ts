// src/lib/server/equipmentVerifyCore.ts
// Logika MURNI (tanpa I/O) verifikasi pengguna unit saat scan EPI:EQUIPMENT:<kode>.
// Dua gate (dipetakan & diatur Superadmin di erp-epi /settings/gates — CLAUDE.md #11):
//   G_FLT_DRIVER_LOCK       — kendaraan perusahaan: hanya driver/pemohon booking aktif yang sah mengoperasikan.
//   G_P2H_BORROWER_VERIFY   — alat kerja/kompresor: tampilkan peminjam resmi; tandai bila pengisi P2H bukan peminjam.
// Mode (shadow/soft/warn/hard) datang dari pemanggil (resolveGateMode); ambang dari fleet_settings dengan bawaan di sini.
//   shadow : tidak menahan, tidak memperingatkan (hanya jejak scan_log)
//   soft/warn : peringatan; pengguna boleh lanjut dengan alasan tertulis
//   hard   : blokir (hanya bila Superadmin mengaktifkan)

import type { GateMode } from '$lib/utils/gateModeResolver';

export const GATE_DRIVER_LOCK = 'G_FLT_DRIVER_LOCK';
export const GATE_P2H_BORROWER = 'G_P2H_BORROWER_VERIFY';
export const DOC_DRIVER_LOCK = 'fleet_booking';
export const DOC_P2H_BORROWER = 'p2h_session';

// ── Setelan (fleet_settings, key = 'driver_lock_*'); bawaan aman bila baris belum dibuat ──────────────────────────
export interface VerifySettings {
	/** Toleransi (menit) sebelum tanggal_mulai / setelah tanggal_selesai_rencana untuk booking berstatus 'disetujui'. */
	graceMinutes: number;
	/** Booking 'aktif' yang melewati batas rencana lebih dari ini (jam) dianggap basi & diabaikan (anti-kunci selamanya). */
	staleAfterHours: number;
	/** Panjang minimum alasan alih-pakai darurat. */
	handoverReasonMin: number;
	/** Permission yang boleh menembus kunci (mis. koordinator armada/GA). */
	overridePermissions: string[];
}

export const DEFAULT_VERIFY_SETTINGS: VerifySettings = {
	graceMinutes: 60,
	staleAfterHours: 36,
	handoverReasonMin: 30,
	overridePermissions: ['admin_panel']
};

export const VERIFY_SETTING_KEYS = [
	'driver_lock_grace_menit',
	'driver_lock_basi_jam',
	'driver_lock_alasan_min',
	'driver_lock_izin_penembus'
] as const;

const num = (v: unknown, fb: number, min: number, max: number) => {
	const n = Number(v);
	return v != null && v !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fb;
};

export function normalizeVerifySettings(rows: { key: string; value: unknown }[] | null | undefined): VerifySettings {
	const m = new Map((rows || []).map((r) => [String(r.key), r.value]));
	const perms = String(m.get('driver_lock_izin_penembus') ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	return {
		graceMinutes: num(m.get('driver_lock_grace_menit'), DEFAULT_VERIFY_SETTINGS.graceMinutes, 0, 1440),
		staleAfterHours: num(m.get('driver_lock_basi_jam'), DEFAULT_VERIFY_SETTINGS.staleAfterHours, 1, 24 * 30),
		handoverReasonMin: num(m.get('driver_lock_alasan_min'), DEFAULT_VERIFY_SETTINGS.handoverReasonMin, 0, 500),
		overridePermissions: perms.length ? perms : [...DEFAULT_VERIFY_SETTINGS.overridePermissions]
	};
}

// ── Booking aktif ─────────────────────────────────────────────────────────────────────────────────────────────────
export interface BookingLite {
	id: string;
	kode_booking?: string | null;
	vehicle_id?: string | null;
	driver_id?: string | null;
	karyawan_id?: string | null;
	butuh_driver?: boolean | null;
	requester_name?: string | null;
	keperluan?: string | null;
	tujuan?: string | null;
	tanggal_mulai?: string | null;
	tanggal_selesai_rencana?: string | null;
	status?: string | null;
}

const MIN = 60_000;
const HOUR = 3_600_000;
const t = (iso: string | null | undefined) => {
	const n = iso ? Date.parse(iso) : NaN;
	return Number.isFinite(n) ? n : null;
};

/** Batas akhir rencana; booking harian tanpa tanggal_selesai_rencana dianggap berlaku 24 jam sejak mulai. */
function plannedEnd(b: BookingLite): number | null {
	const end = t(b.tanggal_selesai_rencana);
	if (end != null) return end;
	const start = t(b.tanggal_mulai);
	return start != null ? start + 24 * HOUR : null;
}

export interface PickResult {
	booking: BookingLite | null;
	/** Ada booking 'aktif' yang diabaikan karena basi — untuk transparansi di respons/log. */
	staleIgnored: BookingLite[];
}

/**
 * Pilih booking yang SEDANG berlaku untuk satu kendaraan.
 *  - 'aktif'    : berlaku selama belum basi (> staleAfterHours lewat batas rencana). Perjalanan yang molor tidak mengunci driver-nya.
 *  - 'disetujui': berlaku hanya di jendela [mulai - grace, selesai + grace].
 * Prioritas: 'aktif' dulu, lalu yang mulai terdekat dengan sekarang.
 */
export function pickActiveBooking(bookings: BookingLite[], nowMs: number, s: VerifySettings): PickResult {
	const grace = s.graceMinutes * MIN;
	const stale = s.staleAfterHours * HOUR;
	const staleIgnored: BookingLite[] = [];
	const valid: BookingLite[] = [];
	for (const b of bookings || []) {
		const start = t(b.tanggal_mulai);
		const end = plannedEnd(b);
		if (b.status === 'aktif') {
			if (end != null && nowMs > end + stale) staleIgnored.push(b);
			else valid.push(b);
		} else if (b.status === 'disetujui') {
			if (start != null && end != null && nowMs >= start - grace && nowMs <= end + grace) valid.push(b);
		}
	}
	valid.sort((a, b) => {
		if ((a.status === 'aktif') !== (b.status === 'aktif')) return a.status === 'aktif' ? -1 : 1;
		return Math.abs((t(a.tanggal_mulai) ?? nowMs) - nowMs) - Math.abs((t(b.tanggal_mulai) ?? nowMs) - nowMs);
	});
	return { booking: valid[0] ?? null, staleIgnored };
}

// ── Keputusan akses kendaraan ─────────────────────────────────────────────────────────────────────────────────────
export type VehicleDecision =
	| 'authorized' // driver sah (atau pemohon yang mengemudi sendiri)
	| 'passenger' // pemohon yang dilayani driver lain — melihat info, bukan pengemudi
	| 'denied' // bukan pemegang sah booking aktif
	| 'free' // tidak ada booking aktif — tersedia (tidak pernah dikunci)
	| 'not_applicable'; // bukan aset perusahaan / identitas pengguna tak terbaca

export interface VehicleVerdict {
	gateKey: string;
	mode: GateMode;
	decision: VehicleDecision;
	/** Pengguna sah mengoperasikan unit (authorized). 'free' & 'passenger' tidak dihitung sah mengemudi, tapi tidak ditolak. */
	isAuthorized: boolean;
	/** Layar blokir (hanya mode hard). */
	blocked: boolean;
	/** Tampilkan peringatan (denied pada mode soft/warn). Shadow = false. */
	warn: boolean;
	/** Denied tercatat sebagai upaya — dipakai logging/alert (juga di shadow, agar kalibrasi mode punya data). */
	attempt: boolean;
	message: string | null;
}

export interface VehicleAccessInput {
	mode: GateMode;
	/** karyawan.id pengguna sesi; null = akun belum tertaut karyawan. */
	karyawanId: string | null;
	pemilik: string | null | undefined;
	booking: BookingLite | null;
	/** karyawan.id driver yang ditugaskan di booking (fleet_drivers.karyawan_id); null = tak ada driver terpisah. */
	driverKaryawanId: string | null;
	/** karyawan.id driver tetap unit (fleet_driver_assignment aktif) — dipakai bila TIDAK ada booking. */
	defaultDriverKaryawanId?: string | null;
}

const verdict = (mode: GateMode, decision: VehicleDecision, extra: Partial<VehicleVerdict> = {}): VehicleVerdict => ({
	gateKey: GATE_DRIVER_LOCK,
	mode,
	decision,
	isAuthorized: decision === 'authorized',
	blocked: false,
	warn: false,
	attempt: false,
	message: null,
	...extra
});

export function decideVehicleAccess(i: VehicleAccessInput): VehicleVerdict {
	const { mode } = i;
	// Aset pribadi tidak dikendalikan sistem; identitas tak terbaca => jangan mengunci siapa pun (fail-open).
	if (String(i.pemilik || '').toLowerCase() === 'pribadi' || !i.karyawanId) return verdict(mode, 'not_applicable');

	const me = String(i.karyawanId);
	const requester = i.booking?.karyawan_id != null ? String(i.booking.karyawan_id) : null;

	if (!i.booking) {
		// Tanpa booking: tidak ada pemegang sah yang bisa dilanggar. Driver tetap unit dianggap sah; selain itu 'free'.
		if (i.defaultDriverKaryawanId && String(i.defaultDriverKaryawanId) === me) return verdict(mode, 'authorized');
		return verdict(mode, 'free');
	}

	if (i.driverKaryawanId && String(i.driverKaryawanId) === me) return verdict(mode, 'authorized');
	const hasOtherDriver = !!i.driverKaryawanId && !!i.booking.butuh_driver;
	if (requester === me) return hasOtherDriver ? verdict(mode, 'passenger') : verdict(mode, 'authorized');

	const holder = i.booking.requester_name || 'pemegang booking';
	const msg = `AKSES DITOLAK: kendaraan ini sedang dipakai ${holder}${i.booking.tujuan ? ` ke ${i.booking.tujuan}` : ''}. Anda tidak terdaftar sebagai pengemudi yang sah.`;
	if (mode === 'shadow') return verdict(mode, 'denied', { attempt: true });
	return verdict(mode, 'denied', { attempt: true, blocked: mode === 'hard', warn: mode !== 'hard', message: msg });
}

// ── Keputusan peminjam alat (P2H) ─────────────────────────────────────────────────────────────────────────────────
export type BorrowerDecision = 'match' | 'mismatch' | 'no_loan' | 'unknown_borrower' | 'not_applicable';

export interface BorrowerVerdict {
	gateKey: string;
	mode: GateMode;
	decision: BorrowerDecision;
	/** Pengisi P2H = peminjam resmi. */
	matches: boolean;
	/** Tampilkan catatan (mismatch pada mode non-shadow). Tidak pernah memblokir P2H — pengisi bisa mekanik/operator lain yang sah. */
	warn: boolean;
	message: string | null;
}

export function decideBorrowerMatch(input: {
	mode: GateMode;
	karyawanId: string | null;
	hasLoan: boolean;
	borrowerKaryawanId: string | null;
}): BorrowerVerdict {
	const base = { gateKey: GATE_P2H_BORROWER, mode: input.mode, matches: false, warn: false, message: null as string | null };
	if (!input.karyawanId) return { ...base, decision: 'not_applicable' };
	if (!input.hasLoan) return { ...base, decision: 'no_loan' };
	if (!input.borrowerKaryawanId) {
		return {
			...base,
			decision: 'unknown_borrower',
			warn: input.mode !== 'shadow',
			message: 'Peminjaman aktif ditemukan, tetapi penanggung jawabnya belum tercatat. Minta admin melengkapi data peminjam.'
		};
	}
	if (String(input.borrowerKaryawanId) === String(input.karyawanId)) return { ...base, decision: 'match', matches: true };
	return {
		...base,
		decision: 'mismatch',
		warn: input.mode !== 'shadow',
		message: 'Anda bukan peminjam resmi unit ini. P2H tetap bisa diisi (mis. sebagai mekanik/operator pengganti), namun tercatat atas nama Anda.'
	};
}

// ── Alih pakai darurat (override) ─────────────────────────────────────────────────────────────────────────────────
export interface OverrideRule {
	/** Boleh melanjutkan setelah mengisi alasan. */
	allowed: boolean;
	/** Panjang minimum alasan; 0 = cukup konfirmasi. */
	reasonMin: number;
}

/**
 * Siapa boleh melanjutkan ketika ditolak:
 *  - soft : siapa pun, dengan alasan tertulis >= reasonMin  (gate "soft" = peringatan + pengecualian beralasan)
 *  - warn : siapa pun, cukup konfirmasi
 *  - hard : hanya pemegang permission penembus, tetap dengan alasan
 *  - shadow: tidak ada layar -> tidak relevan
 */
export function decideOverride(mode: GateMode, hasOverridePermission: boolean, reasonMin: number): OverrideRule {
	if (mode === 'hard') return { allowed: hasOverridePermission, reasonMin };
	if (mode === 'warn') return { allowed: true, reasonMin: 0 };
	return { allowed: true, reasonMin: mode === 'soft' ? reasonMin : 0 };
}

export const MAX_REASON_LEN = 300;

/** Alasan dibersihkan agar aman disimpan di `notes` berpemisah "|" (tanpa pemisah/newline, dipotong). */
export function normalizeReason(raw: unknown): string {
	return String(raw ?? '')
		.replace(/[|\r\n\t]+/g, ' ')
		.replace(/\s{2,}/g, ' ')
		.trim()
		.slice(0, MAX_REASON_LEN);
}

export function isReasonValid(reason: string, min: number): boolean {
	return reason.length >= Math.max(0, min);
}

// ── GPS dari klien (tidak dipercaya mentah) ───────────────────────────────────────────────────────────────────────
export interface Gps {
	lat: number;
	lng: number;
	accuracy?: number;
}

/** Koordinat dari body request -> nilai aman untuk scan_log, atau null bila bukan angka valid (lat -90..90, lng -180..180). */
export function sanitizeGps(raw: unknown): Gps | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const lat = typeof r.lat === 'number' ? r.lat : NaN;
	const lng = typeof r.lng === 'number' ? r.lng : NaN;
	if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
	const out: Gps = { lat, lng };
	if (typeof r.accuracy === 'number' && Number.isFinite(r.accuracy) && r.accuracy >= 0 && r.accuracy < 100000) out.accuracy = Math.round(r.accuracy);
	return out;
}
