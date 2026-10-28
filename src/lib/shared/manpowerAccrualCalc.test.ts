import { describe, it, expect } from 'vitest';
import { hitungBiayaHarian, pilihRate, rateKosong } from './manpowerAccrualCalc';

describe('pilihRate / hitungBiayaHarian (R2-02)', () => {
	it('rate dari penugasan (rate_harian) dipakai; master manpower tanpa kolom rate tidak menyumbang', () => {
		const rate = pilihRate({ rate_harian: 200000 }, { id: 1, nama: 'A' });
		expect(rate.rateHarian).toBe(200000);
		expect(hitungBiayaHarian({ status: 'hadir' }, rate)).toBe(200000);
	});
	it('setengah hari = 50%', () => {
		expect(hitungBiayaHarian({ status: 'setengah_hari' }, pilihRate({ rate_harian: 150000 }, null))).toBe(75000);
	});
});

describe('rateKosong (R2-02)', () => {
	it('hadir tanpa rate -> true', () => {
		expect(rateKosong({ status: 'hadir' }, pilihRate({}, null))).toBe(true);
		expect(rateKosong({ status: 'setengah_hari' }, pilihRate({ rate_harian: 0 }, null))).toBe(true);
	});
	it('hadir dengan rate -> false', () => {
		expect(rateKosong({ status: 'hadir' }, pilihRate({ rate_harian: 180000 }, null))).toBe(false);
	});
	it('izin/sakit/alpha memang tak berbiaya -> false', () => {
		expect(rateKosong({ status: 'izin' }, pilihRate({}, null))).toBe(false);
		expect(rateKosong({ status: 'alpha' }, pilihRate({}, null))).toBe(false);
	});
	it('standby dinilai dari rate standby', () => {
		expect(rateKosong({ status: 'hadir', is_standby: true }, pilihRate({ rate_harian: 200000 }, null))).toBe(true);
		expect(rateKosong({ status: 'hadir', is_standby: true }, pilihRate({ rate_standby: 100000 }, null))).toBe(false);
	});
});
