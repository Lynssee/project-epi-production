import { describe, it, expect } from 'vitest';
import { computeDue, validateCheckin, isoWeekCode, monthCode, weekdayOf, TIPE } from './motivationModel';
import { resolveCultureSettings, CULTURE_DEFAULTS } from './cultureModel';

const base = { 'culture.mood_checkin_enabled': true, 'culture.mood_checkin_day': 'Senin', 'culture.pulse_enps_day_of_month': 1 };

describe('motivationModel (salinan setia erp-epi)', () => {
	it('kode periode & hari', () => {
		expect(isoWeekCode('2026-11-13')).toBe('2026-W46');
		expect(isoWeekCode('2027-01-01')).toBe('2026-W53');
		expect(monthCode('2026-11-13')).toBe('2026-11');
		expect(weekdayOf('2026-11-13')).toBe(5);
	});
	it('computeDue: pulse dulu, lalu mood, null setelah diisi / dimatikan', () => {
		expect(computeDue({ today: '2026-11-13', settings: base, answered: new Set() })).toEqual({ tipe: TIPE.PULSE, periode_kode: '2026-11' });
		const a = new Set([`${TIPE.PULSE}|2026-11`]);
		expect(computeDue({ today: '2026-11-13', settings: base, answered: a })).toEqual({ tipe: TIPE.MOOD, periode_kode: '2026-W46' });
		a.add(`${TIPE.MOOD}|2026-W46`);
		expect(computeDue({ today: '2026-11-13', settings: base, answered: a })).toBeNull();
		expect(computeDue({ today: '2026-11-13', settings: { 'culture.mood_checkin_enabled': false }, answered: new Set() })).toBeNull();
		expect(computeDue({ today: '2026-11-12', settings: { ...base, 'culture.mood_checkin_day': 'Jumat', 'culture.pulse_enps_day_of_month': 20 }, answered: new Set() })).toBeNull();
	});
	it('validateCheckin', () => {
		expect(validateCheckin({}, TIPE.MOOD).ok).toBe(false);
		const r = validateCheckin({ skor_semangat: 4, faktor_utama: 'apresiasi' }, TIPE.MOOD);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.data).toMatchObject({ skor_semangat: 4, anonim: true, faktor_utama: 'apresiasi' });
		expect(validateCheckin({ skor_semangat: 3 }, TIPE.PULSE).ok).toBe(false);
		expect(validateCheckin({ skor_semangat: 3, skor_belonging: 10, skor_kejelasan_visi: 1 }, TIPE.PULSE).ok).toBe(true);
		expect(validateCheckin({ skor_semangat: 3, faktor_utama: 'ngawur' }, TIPE.MOOD).ok).toBe(false);
	});
	it('setelan bertipe: angka di-clamp, pilihan hari divalidasi, default tetap', () => {
		expect(resolveCultureSettings(null)).toEqual(CULTURE_DEFAULTS);
		const r = resolveCultureSettings([
			{ setting_key: 'culture.pulse_enps_day_of_month', setting_value: '99' },
			{ setting_key: 'culture.mood_checkin_day', setting_value: 'rabu' },
			{ setting_key: 'culture.motivation_alert_threshold', setting_value: 'abc' }
		]);
		expect(r['culture.pulse_enps_day_of_month']).toBe(28);
		expect(r['culture.mood_checkin_day']).toBe('Rabu');
		expect(r['culture.motivation_alert_threshold']).toBe(3);
	});
});
