import { describe, expect, it } from 'vitest';
import { filterBiayaRealisasi, jumlahkanRealisasi, perluHitung, putuskanSettlement } from './fleetSettlementCalc';

describe('filterBiayaRealisasi', () => {
	it('menyertakan NULL baris lama, mengecualikan ditolak/menunggu', () => {
		const f = filterBiayaRealisasi('9');
		expect(f._and[0]).toEqual({ trip_log_id: { _eq: '9' } });
		const or = (f._and[1] as any)._or;
		expect(or).toContainEqual({ approval_status: { _null: true } });
		expect(or).toContainEqual({ approval_status: { _nin: ['ditolak', 'menunggu'] } });
	});
});

describe('jumlahkanRealisasi', () => {
	it('per jenis, tak dikenal → lain, null aman', () => {
		expect(
			jumlahkanRealisasi([{ jenis: 'bbm', nominal: '100000' }, { jenis: 'tol', nominal: 20000 }, { jenis: 'x', nominal: 5 }, { jenis: 'bbm', nominal: null }])
		).toEqual({ bbm: 100000, tol: 20000, parkir: 0, lain: 5, total: 120005 });
		expect(jumlahkanRealisasi(null).total).toBe(0);
	});
});

describe('perluHitung', () => {
	it('belum dihitung atau menunggu struk final → hitung; sisanya jangan', () => {
		expect(perluHitung({})).toBe(true);
		expect(perluHitung({ settlement_status: 'none' })).toBe(true);
		expect(perluHitung({ settlement_status: 'menunggu_struk_final' })).toBe(true);
		expect(perluHitung({ settlement_status: 'menunggu_setor_balik' })).toBe(false);
		expect(perluHitung({ settlement_status: 'balanced' })).toBe(false);
		expect(perluHitung(null)).toBe(true);
	});
});

describe('putuskanSettlement (U7: struk menunggu → tanpa setor/reimburse)', () => {
	it('ada struk menunggu → menunggu_struk_final, TANPA reimburse walau kurang', () => {
		const k = putuskanSettlement({ disbursed: 300000, realisasiTotal: 100000, adaStrukMenunggu: true, sudahReimburse: false });
		expect(k).toMatchObject({ settlement_status: 'menunggu_struk_final', buatReimburse: false, selesai: false, selisih: 200000 });
		const k2 = putuskanSettlement({ disbursed: 100000, realisasiTotal: 400000, adaStrukMenunggu: true, sudahReimburse: false });
		expect(k2.buatReimburse).toBe(false);
	});
	it('sisa → setor balik; pas → balanced+selesai; kurang → reimburse', () => {
		expect(putuskanSettlement({ disbursed: 300000, realisasiTotal: 250000, adaStrukMenunggu: false, sudahReimburse: false }).settlement_status).toBe('menunggu_setor_balik');
		expect(putuskanSettlement({ disbursed: 300000, realisasiTotal: 300000, adaStrukMenunggu: false, sudahReimburse: false })).toMatchObject({ settlement_status: 'balanced', selesai: true });
		expect(putuskanSettlement({ disbursed: 300000, realisasiTotal: 350000, adaStrukMenunggu: false, sudahReimburse: false })).toMatchObject({ settlement_status: 'menunggu_reimburse', buatReimburse: true, selisih: -50000 });
	});
	it('idempoten: reimburse kekurangan tidak dibuat dua kali (U8)', () => {
		const k = putuskanSettlement({ disbursed: 300000, realisasiTotal: 350000, adaStrukMenunggu: false, sudahReimburse: true });
		expect(k).toMatchObject({ settlement_status: 'menunggu_reimburse', buatReimburse: false });
	});
	it('nilai NaN/null tidak menghasilkan NaN', () => {
		const k = putuskanSettlement({ disbursed: NaN, realisasiTotal: null as any, adaStrukMenunggu: false, sudahReimburse: false });
		expect(k.selisih).toBe(0);
		expect(k.settlement_status).toBe('balanced');
	});
});
