// src/lib/shared/visitTutup.ts
// PDP-33 — logika MURNI tutup visit leader untuk sisi HP/server project-epi. Kembar erp-epi
// src/lib/data/visitTutup.js — jaga keduanya tetap sama (setelan, validasi, definisi "tertutup sah").
//
// Setelan (app_settings module 'project'; default di kode):
//   visit.batas_tutup_jam '17:00' · visit.pengingat_menit_sebelum 60 · visit.rekap_sore_jam '17:30' · visit.min_foto 1

export const VISIT_SETTING_KEYS = {
	BATAS: 'visit.batas_tutup_jam',
	PENGINGAT: 'visit.pengingat_menit_sebelum',
	REKAP: 'visit.rekap_sore_jam',
	MIN_FOTO: 'visit.min_foto'
} as const;

export interface SetelanVisit {
	batasJam: string;
	pengingatMenit: number;
	rekapJam: string;
	minFoto: number;
}
export const VISIT_DEFAULT: Readonly<SetelanVisit> = Object.freeze({ batasJam: '17:00', pengingatMenit: 60, rekapJam: '17:30', minFoto: 1 });

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const parseVal = (v: unknown): unknown => {
	if (typeof v !== 'string') return v;
	try {
		return JSON.parse(v);
	} catch {
		return v;
	}
};

export function bacaSetelanVisit(map: Record<string, unknown> | null | undefined): SetelanVisit {
	const m = map || {};
	const jam = (k: string, d: string) => {
		const v = String(parseVal(m[k]) ?? '').trim();
		return HM.test(v) ? v : d;
	};
	const angka = (k: string, d: number, min: number, max: number) => {
		const n = Number(parseVal(m[k]));
		return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : d;
	};
	return {
		batasJam: jam(VISIT_SETTING_KEYS.BATAS, VISIT_DEFAULT.batasJam),
		pengingatMenit: angka(VISIT_SETTING_KEYS.PENGINGAT, VISIT_DEFAULT.pengingatMenit, 5, 600),
		rekapJam: jam(VISIT_SETTING_KEYS.REKAP, VISIT_DEFAULT.rekapJam),
		minFoto: angka(VISIT_SETTING_KEYS.MIN_FOTO, VISIT_DEFAULT.minFoto, 0, 10)
	};
}

export function validasiTutup(p: { kegiatan: unknown; fotoCount: unknown; minFoto?: number }): { ok: true } | { ok: false; error: string } {
	const min = p.minFoto ?? VISIT_DEFAULT.minFoto;
	if (String(p.kegiatan ?? '').trim().length < 5) return { ok: false, error: 'Tulis kegiatan hari ini (minimal 5 karakter).' };
	if ((Number(p.fotoCount) || 0) < min) return { ok: false, error: `Lampirkan minimal ${min} foto kunjungan.` };
	return { ok: true };
}

export const STATUS_TERBUKA = ['open', 'in_progress'] as const;
export const adalahTerbuka = (v: { status?: string | null } | null | undefined): boolean =>
	!!v && (STATUS_TERBUKA as readonly string[]).includes(String(v.status || ''));

export const visitTertutupSah = (v: { status?: string | null; cara_tutup?: string | null } | null | undefined): boolean =>
	!!v && String(v.status || '') === 'closed' && String(v.cara_tutup || '') !== 'sistem_massal';

export function menitKeBatas(nowHM: string, batasHM: string): number | null {
	if (!HM.test(nowHM) || !HM.test(batasHM)) return null;
	const f = (s: string) => {
		const [h, m] = s.split(':').map(Number);
		return h * 60 + m;
	};
	return f(batasHM) - f(nowHM);
}

/** Jam sekarang WIB (HH:MM). */
export function jamWIB(now: Date = new Date()): string {
	return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
}
