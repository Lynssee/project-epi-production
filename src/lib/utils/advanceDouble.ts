// src/lib/utils/advanceDouble.ts
// Peminjaman 06 Fase 3 — cegah bayar dobel: struk perjalanan yang sudah ditanggung UANG MUKA (LPJ Kas Kecil)
// tidak boleh juga diajukan sebagai reimburse (Biaya Lapangan mode talangan). Logika murni, dipakai klien & server.

export type DoubleGateMode = 'shadow' | 'soft' | 'hard';
export type AksiDobel = 'lolos' | 'catat' | 'label' | 'blokir';

/** Jenis biaya yang tercakup uang muka perjalanan. */
export const JENIS_DOBEL = ['bbm', 'tol', 'parkir'] as const;

const STATUS_UANG_MUKA_AKTIF = ['diajukan', 'menunggu_kasir', 'disetujui', 'dicairkan', 'settled'];

/** Booking ini memakai uang muka yang MASIH berlaku (bukan ditolak/dibatalkan/tidak meminta). */
export function isBookingBeruangMuka(
	b: { advance_diminta?: boolean | null; advance_status?: string | null } | null | undefined
): boolean {
	// Directus live mengembalikan boolean sebagai 1/0 (bukan true/false) — `!== true` membuat gate TIDAK PERNAH aktif pada data nyata.
	const v: unknown = b?.advance_diminta;
	const diminta = v === true || v === 1 || ['1', 'true'].includes(String(v ?? '').trim().toLowerCase());
	if (!b || !diminta) return false;
	return STATUS_UANG_MUKA_AKTIF.includes(String(b.advance_status ?? ''));
}

/**
 * Keputusan gate G_ADVANCE_NO_DOUBLE. Hanya berlaku untuk reimburse (mode talangan) jenis BBM/tol/parkir
 * pada trip beruang muka. shadow → hanya dicatat; soft → klaim tetap dibuat + label POTENSI DOBEL; hard → blokir.
 */
export function keputusanDobel(p: {
	gateMode: DoubleGateMode;
	modeBiaya: string;
	jenis: string;
	beruangMuka: boolean;
}): AksiDobel {
	if (!p.beruangMuka || p.modeBiaya !== 'talangan') return 'lolos';
	if (!(JENIS_DOBEL as readonly string[]).includes(p.jenis)) return 'lolos';
	if (p.gateMode === 'hard') return 'blokir';
	if (p.gateMode === 'soft') return 'label';
	return 'catat';
}

/** Penanda yang ditempel di catatan klaim agar approver/Finance melihatnya. */
export function labelPotensiDobel(tripId: string | number, kodeBooking?: string | null): string {
	return `[POTENSI DOBEL: trip ${tripId}${kodeBooking ? ` ${kodeBooking}` : ''}]`;
}

/** Klaim mana pun yang membawa penanda di atas. */
export function adaLabelPotensiDobel(catatan: string | null | undefined): boolean {
	return String(catatan ?? '').includes('[POTENSI DOBEL');
}
