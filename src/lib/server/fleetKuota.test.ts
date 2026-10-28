import { describe, expect, it } from 'vitest';
import { bookingBeririsan, evaluasiKuota, normalizeKuotaMode } from './fleetKuota';

const t = (s: string) => new Date(s).getTime();
const bk = (kode: string, mulai: string, selesai: string | null): { kode_booking: string; tanggal_mulai: string; tanggal_selesai_rencana: string | null } => ({
	kode_booking: kode,
	tanggal_mulai: mulai,
	tanggal_selesai_rencana: selesai
});

describe('normalizeKuotaMode', () => {
	it('off/hard dikenali; selain itu (kosong, ngawur) → soft', () => {
		expect(normalizeKuotaMode('off')).toBe('off');
		expect(normalizeKuotaMode(' HARD ')).toBe('hard');
		expect(normalizeKuotaMode('"hard"')).toBe('hard');
		expect(normalizeKuotaMode(undefined)).toBe('soft');
		expect(normalizeKuotaMode('aneh')).toBe('soft');
	});
});

describe('bookingBeririsan', () => {
	const minggu = bk('BK-MINGGU', '2026-10-06T08:00:00Z', '2026-10-06T17:00:00Z');
	const hariIni = bk('BK-HARI', '2026-09-30T08:00:00Z', '2026-09-30T17:00:00Z');
	it('booking minggu depan tidak menghabiskan kuota hari ini (U1)', () => {
		const r = bookingBeririsan([minggu, minggu, minggu], t('2026-09-30T09:00:00Z'), t('2026-09-30T12:00:00Z'));
		expect(r).toHaveLength(0);
	});
	it('rentang yang bersinggungan dihitung; berujung tepat di batas ikut beririsan', () => {
		expect(bookingBeririsan([hariIni], t('2026-09-30T17:00:00Z'), t('2026-09-30T18:00:00Z'))).toHaveLength(1);
		expect(bookingBeririsan([hariIni], t('2026-09-30T17:00:01Z'), t('2026-09-30T18:00:00Z'))).toHaveLength(0);
	});
	it('booking tanpa jam selesai dianggap titik waktu', () => {
		const tanpaSelesai = bk('BK-X', '2026-09-30T10:00:00Z', null);
		expect(bookingBeririsan([tanpaSelesai], t('2026-09-30T09:00:00Z'), t('2026-09-30T11:00:00Z'))).toHaveLength(1);
		expect(bookingBeririsan([tanpaSelesai], t('2026-09-30T11:00:00Z'), t('2026-09-30T12:00:00Z'))).toHaveLength(0);
	});
	it('tanggal rusak diabaikan, input kosong/null aman', () => {
		expect(bookingBeririsan([bk('BK-RUSAK', 'bukan-tanggal', null)], 0, 9e15)).toHaveLength(0);
		expect(bookingBeririsan(null as any, 0, 1)).toHaveLength(0);
	});
});

describe('evaluasiKuota', () => {
	const tiga = [
		bk('BK-1', '2026-09-30T08:00:00Z', '2026-09-30T12:00:00Z'),
		bk('BK-2', '2026-09-30T09:00:00Z', '2026-09-30T10:00:00Z'),
		bk('BK-3', '2026-09-30T11:00:00Z', '2026-09-30T15:00:00Z')
	];
	it('3 beririsan, maks 3 → terlampaui + pesan menyebut kode (U3)', () => {
		const r = evaluasiKuota(tiga, t('2026-09-30T09:30:00Z'), t('2026-09-30T11:30:00Z'), 3);
		expect(r.terlampaui).toBe(true);
		expect(r.kode).toEqual(['BK-1', 'BK-2', 'BK-3']);
		expect(r.pesan).toContain('3 unit (BK-1, BK-2, BK-3)');
		expect(r.pesan).toContain('Hubungi GA');
	});
	it('2 beririsan, maks 3 → aman', () => {
		expect(evaluasiKuota(tiga, t('2026-09-30T13:00:00Z'), t('2026-09-30T14:00:00Z'), 3).terlampaui).toBe(false);
	});
	it('maks 0 = tanpa batas', () => {
		expect(evaluasiKuota(tiga, t('2026-09-30T09:30:00Z'), t('2026-09-30T11:30:00Z'), 0).terlampaui).toBe(false);
	});
});
