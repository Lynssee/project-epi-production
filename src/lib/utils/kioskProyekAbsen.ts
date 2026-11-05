// src/lib/utils/kioskProyekAbsen.ts
// Aturan absen kiosk yang MURNI (Rencana Kiosk Proyek, Fase 2): keputusan gate per mode dan
// jendela jam. Mode gate dibaca dari gate_definitions oleh pemanggil — tidak ada hardcode di sini.

export type GateMode = 'shadow' | 'soft' | 'warn' | 'hard';

export interface KeputusanGate {
	/** hard → absen ditolak. */
	tolak: boolean;
	/** warn/soft → absen diterima TAPI ditandai agar terlihat leader. */
	tandai: boolean;
	/** shadow → hanya jejak log, kru & leader tidak melihat apa-apa (Aturan #3: gate baru mulai senyap). */
	catat: boolean;
}

export function keputusanGate(mode: GateMode): KeputusanGate {
	switch (mode) {
		case 'hard':
			return { tolak: true, tandai: false, catat: false };
		case 'soft':
		case 'warn':
			return { tolak: false, tandai: true, catat: false };
		default:
			return { tolak: false, tandai: false, catat: true };
	}
}

/** "HH:MM" menurut zona WIB dari sebuah Date (jam SERVER, bukan jam HP). */
export function jamWIB(now: Date = new Date()): string {
	return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
}

export interface JendelaSetelan {
	'kiosk_proyek.jendela_masuk_mulai': string;
	'kiosk_proyek.jendela_masuk_selesai': string;
	'kiosk_proyek.jendela_pulang_mulai': string;
	'kiosk_proyek.jendela_pulang_selesai': string;
}

/** ok=false bila di luar jendela; alasan siap ditampilkan ke kru. */
export function cekJendela(jenis: 'masuk' | 'pulang', now: Date, s: JendelaSetelan): { ok: boolean; alasan?: string } {
	const mulai = s[`kiosk_proyek.jendela_${jenis}_mulai`];
	const selesai = s[`kiosk_proyek.jendela_${jenis}_selesai`];
	const jam = jamWIB(now);
	if (jam >= mulai && jam <= selesai) return { ok: true };
	const kata = jenis === 'masuk' ? 'masuk' : 'pulang';
	return { ok: false, alasan: `Absen ${kata} dibuka pukul ${mulai}–${selesai} WIB (sekarang ${jam}).` };
}

/** Penanda foto di directus_files.title — dipakai mencari foto yang sama dipakai ulang. */
export const FOTO_HASH_PREFIX = 'kp-sha256:';
