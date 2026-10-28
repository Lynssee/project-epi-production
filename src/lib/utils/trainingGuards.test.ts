// EPI Academy Fase 5 — aturan murni LMS lapangan: guard 'Lulus' + waktu baca minimum modul Teks.
import { describe, it, expect } from 'vitest';
import {
	READ_GATE_DEFAULTS,
	computeMinReadSeconds,
	formatCountdown,
	isFinalQuizRetakeBlocked,
	parseReadGateSettings,
	remainingReadSeconds,
	resolveEnrollmentStatusAfterRecompute
} from './trainingGuards';

describe('isFinalQuizRetakeBlocked', () => {
	it('kuis akhir (module_id kosong) + Lulus → diblokir', () => {
		expect(isFinalQuizRetakeBlocked({ module_id: null }, 'Lulus')).toBe(true);
		expect(isFinalQuizRetakeBlocked({ module_id: undefined }, 'Lulus')).toBe(true);
	});
	it('kuis akhir + status belum Lulus → boleh (Ongoing/Remedial/Enrolled)', () => {
		for (const s of ['Enrolled', 'Ongoing', 'Remedial', null, undefined]) {
			expect(isFinalQuizRetakeBlocked({ module_id: null }, s)).toBe(false);
		}
	});
	it('kuis formatif per modul tetap boleh diulang walau sudah Lulus', () => {
		expect(isFinalQuizRetakeBlocked({ module_id: 7 }, 'Lulus')).toBe(false);
	});
});

describe('resolveEnrollmentStatusAfterRecompute', () => {
	it('Lulus tidak pernah diturunkan', () => {
		expect(resolveEnrollmentStatusAfterRecompute('Lulus', 'Ongoing')).toBe('Lulus');
		expect(resolveEnrollmentStatusAfterRecompute('Lulus', 'Enrolled')).toBe('Lulus');
	});
	it('status lain mengikuti hasil hitung', () => {
		expect(resolveEnrollmentStatusAfterRecompute('Enrolled', 'Ongoing')).toBe('Ongoing');
		expect(resolveEnrollmentStatusAfterRecompute('Remedial', 'Ongoing')).toBe('Ongoing');
		expect(resolveEnrollmentStatusAfterRecompute(undefined, 'Lulus')).toBe('Lulus');
	});
});

describe('computeMinReadSeconds', () => {
	const teks = (durasi: number | null) => ({ tipe_konten: 'Teks', durasi_menit: durasi });
	it('default: 50% durasi, dibatasi 300 detik', () => {
		expect(computeMinReadSeconds(teks(4))).toBe(120); // 4m*60*50%
		expect(computeMinReadSeconds(teks(30))).toBe(300); // 900 → dibatasi maks
	});
	it('mengikuti setelan persen & maks', () => {
		const s = { ...READ_GATE_DEFAULTS, persen: 90, maksDetik: 3600 };
		expect(computeMinReadSeconds(teks(10), s)).toBe(540);
	});
	it('modul lama tanpa durasi_menit tidak dikunci', () => {
		expect(computeMinReadSeconds(teks(null))).toBe(0);
		expect(computeMinReadSeconds(teks(0))).toBe(0);
	});
	it('PDF dan Link ikut dikunci (jenis konten dibaca/dipelajari)', () => {
		expect(computeMinReadSeconds({ tipe_konten: 'PDF', durasi_menit: 10 })).toBe(300);
		expect(computeMinReadSeconds({ tipe_konten: 'Link', durasi_menit: 2 })).toBe(60);
	});
	it('Video terlacak tidak dikunci; Video mode manual (fallback) dikunci', () => {
		expect(computeMinReadSeconds({ tipe_konten: 'Video', durasi_menit: 10 })).toBe(0);
		expect(computeMinReadSeconds({ tipe_konten: 'Video', durasi_menit: 10 }, READ_GATE_DEFAULTS, { manual: true })).toBe(300);
		expect(computeMinReadSeconds({ tipe_konten: null, durasi_menit: 10 }, READ_GATE_DEFAULTS, { manual: true })).toBe(0);
	});
	it('jenis konten bisa dipilih lewat setelan (tipe)', () => {
		const s = { ...READ_GATE_DEFAULTS, tipe: ['Teks'] };
		expect(computeMinReadSeconds({ tipe_konten: 'Teks', durasi_menit: 4 }, s)).toBe(120);
		expect(computeMinReadSeconds({ tipe_konten: 'PDF', durasi_menit: 4 }, s)).toBe(0);
		expect(computeMinReadSeconds({ tipe_konten: 'Video', durasi_menit: 4 }, s, { manual: true })).toBe(0);
	});
	it('saklar mati → perilaku lama (0)', () => {
		expect(computeMinReadSeconds(teks(10), { ...READ_GATE_DEFAULTS, aktif: false })).toBe(0);
	});
});

describe('remainingReadSeconds / formatCountdown', () => {
	it('sisa tidak negatif; input rusak dianggap 0 detik terbaca', () => {
		expect(remainingReadSeconds(120, 30)).toBe(90);
		expect(remainingReadSeconds(120, 500)).toBe(0);
		expect(remainingReadSeconds(120, null)).toBe(120);
		expect(remainingReadSeconds(120, NaN)).toBe(120);
		expect(remainingReadSeconds(0, 0)).toBe(0);
	});
	it('format m:ss', () => {
		expect(formatCountdown(65)).toBe('1:05');
		expect(formatCountdown(9)).toBe('0:09');
		expect(formatCountdown(-3)).toBe('0:00');
	});
});

describe('parseReadGateSettings', () => {
	it('tanpa baris → default', () => {
		expect(parseReadGateSettings([])).toEqual(READ_GATE_DEFAULTS);
	});
	it('membaca ketiga kunci (string dari app_settings)', () => {
		expect(
			parseReadGateSettings([
				{ setting_key: 'baca_min_aktif', setting_value: 'false' },
				{ setting_key: 'baca_min_persen', setting_value: '75' },
				{ setting_key: 'baca_min_detik_maks', setting_value: '600' }
			])
		).toEqual({ ...READ_GATE_DEFAULTS, aktif: false, persen: 75, maksDetik: 600 });
	});
	it('baca_min_tipe: array JSON, CSV, kosong sah, rusak → default', () => {
		const t = (v: unknown) => parseReadGateSettings([{ setting_key: 'baca_min_tipe', setting_value: v }]).tipe;
		expect(t('["Teks","PDF"]')).toEqual(['Teks', 'PDF']);
		expect(t('Teks, Link')).toEqual(['Teks', 'Link']);
		expect(t('[]')).toEqual([]);
		expect(t('')).toEqual([]);
		expect(t('[bukan json')).toEqual(READ_GATE_DEFAULTS.tipe);
		expect(t('Audio,Gambar')).toEqual(READ_GATE_DEFAULTS.tipe);
		expect(t('Teks,Audio')).toEqual(['Teks']);
	});
	it('nilai rusak/di luar rentang jatuh ke default', () => {
		const s = parseReadGateSettings([
			{ setting_key: 'baca_min_persen', setting_value: '500' },
			{ setting_key: 'baca_min_detik_maks', setting_value: 'abc' },
			{ setting_key: 'baca_min_aktif', setting_value: 'mungkin' }
		]);
		expect(s).toEqual(READ_GATE_DEFAULTS);
	});
});
