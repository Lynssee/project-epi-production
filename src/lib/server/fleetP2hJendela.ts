// src/lib/server/fleetP2hJendela.ts
// Peminjaman 12 §5 — jendela waktu P2H "sebelum pakai". Dulu P2H bisa dikirim berhari-hari sebelum jadwal (atau dari
// rumah) → status langsung `aktif`, unit terkunci lebih awal, rekonsiliasi waktu kacau. Gate baru → mulai SOFT (Aturan #3).
// Logika murni (diuji). Waktu kejadian memakai waktu di HP bila P2H masuk lewat antrean offline (bukan waktu sinkron).

export type JendelaMode = 'off' | 'soft' | 'hard';

export const JENDELA_DEFAULT_JAM = 3;

export function normalizeJendelaMode(raw: unknown): JendelaMode {
	const v = String(raw ?? '').replace(/"/g, '').trim().toLowerCase();
	return v === 'off' || v === 'hard' ? v : 'soft';
}

export function normalizeJendelaJam(raw: unknown): number {
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? n : JENDELA_DEFAULT_JAM;
}

/** "08.30 WIB" untuk pesan penolakan. */
export function jamWib(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '-';
	return `${new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)} WIB`;
}

export type HasilJendela =
	| { status: 'ok' }
	| { status: 'terlalu_awal'; jamLebihAwal: number; flag: string }
	| { status: 'tolak'; pesan: string };

/**
 * @param mulaiIso   booking.tanggal_mulai
 * @param kejadianIso  waktu P2H diisi (event time)
 */
export function evaluasiJendelaP2h(p: { mulaiIso?: string | null; kejadianIso: string; jendelaJam: number; mode: JendelaMode }): HasilJendela {
	if (p.mode === 'off' || !p.mulaiIso) return { status: 'ok' };
	const mulai = new Date(p.mulaiIso).getTime();
	const kejadian = new Date(p.kejadianIso).getTime();
	if (!Number.isFinite(mulai) || !Number.isFinite(kejadian)) return { status: 'ok' }; // data rusak: jangan menghalangi lapangan
	const lebihAwalMs = mulai - kejadian;
	if (lebihAwalMs <= p.jendelaJam * 3600 * 1000) return { status: 'ok' };
	const jamLebihAwal = Math.round((lebihAwalMs / 3600 / 1000) * 10) / 10;
	if (p.mode === 'hard') {
		return { status: 'tolak', pesan: `Cek kendaraan maksimal ${p.jendelaJam} jam sebelum jadwal berangkat (${jamWib(p.mulaiIso)}).` };
	}
	return { status: 'terlalu_awal', jamLebihAwal, flag: `[P2H_TERLALU_AWAL] P2H diisi ${jamLebihAwal} jam sebelum jadwal (batas ${p.jendelaJam} jam).` };
}
