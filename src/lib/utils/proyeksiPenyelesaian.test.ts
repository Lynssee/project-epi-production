import { describe, it, expect } from 'vitest';
import { hitungProyeksiPenyelesaian } from './proyeksiPenyelesaian';

const base = [{ d: '2026-10-01', p: 10 }, { d: '2026-11-30', p: 60 }, { d: '2026-12-31', p: 100 }];

describe('hitungProyeksiPenyelesaian', () => {
	it('tanpa data aktual → tidak_cukup_data', () => {
		expect(hitungProyeksiPenyelesaian([], base, '2026-11-18').status).toBe('tidak_cukup_data');
		expect(hitungProyeksiPenyelesaian(null, null, '2026-11-18').proyeksiSelesai).toBeNull();
	});
	it('laju linear → tanggal proyeksi & selisih terhadap rencana', () => {
		// 14 hari lalu 30% → sekarang 44% : 1 poin/hari → sisa 56 hari dari 2026-11-18 = 2027-01-13; rencana 2026-12-31 → +13 hari
		const act = [{ d: '2026-11-04', p: 30 }, { d: '2026-11-18', p: 44 }];
		const r = hitungProyeksiPenyelesaian(act, base, '2026-11-18');
		expect(r.pacePerHari).toBe(1);
		expect(r.proyeksiSelesai).toBe('2027-01-13');
		expect(r.rencanaSelesai).toBe('2026-12-31');
		expect(r.selisihHari).toBe(13);
		expect(r.status).toBe('terlambat');
	});
	it('lebih cepat dari rencana', () => {
		const act = [{ d: '2026-11-04', p: 40 }, { d: '2026-11-18', p: 68 }]; // 2 poin/hari → 16 hari → 2026-12-04
		const r = hitungProyeksiPenyelesaian(act, base, '2026-11-18');
		expect(r.proyeksiSelesai).toBe('2026-12-04');
		expect(r.status).toBe('lebih_cepat');
	});
	it('progres tidak naik → stagnan (bukan tanggal karangan)', () => {
		const act = [{ d: '2026-11-04', p: 50 }, { d: '2026-11-18', p: 50 }];
		const r = hitungProyeksiPenyelesaian(act, base, '2026-11-18');
		expect(r.status).toBe('stagnan'); expect(r.proyeksiSelesai).toBeNull();
	});
	it('sudah 100% → selesai; jendela < 7 hari → tidak_cukup_data', () => {
		expect(hitungProyeksiPenyelesaian([{ d: '2026-11-10', p: 100 }], base, '2026-11-18').status).toBe('selesai');
		expect(hitungProyeksiPenyelesaian([{ d: '2026-11-15', p: 5 }, { d: '2026-11-18', p: 9 }], base, '2026-11-18').status).toBe('tidak_cukup_data');
	});
});
