import { describe, it, expect } from 'vitest';
import { computeTunggakanFisik, normalizeTunggakanRules, workingDaysBetween } from './sjTunggakanFisik';

const NOW = new Date('2026-10-14T09:00:00'); // Rabu
const rules = normalizeTunggakanRules({ maxOutstanding: 1, graceDays: 3, enforceFrom: '' });

describe('sjTunggakanFisik (paritas erp-epi)', () => {
	it('hari kerja melewati akhir pekan', () => {
		expect(workingDaysBetween('2026-10-09T10:00:00', NOW)).toBe(3);
	});
	it('menunggak bila lewat grace & tanpa scan; dalam grace tidak', () => {
		const out = computeTunggakanFisik(
			[{ id: 1, nomor_sj: 'SJ-1', received_at: '2026-10-01T08:00:00' }, { id: 2, received_at: '2026-10-13T08:00:00' }],
			new Map(), rules, NOW
		);
		expect(out.count).toBe(1);
		expect(out.rows[0].nomor_sj).toBe('SJ-1');
	});
	it('scan ada + lembar diarsip = bukan tunggakan; lembar belum = tunggakan', () => {
		const sj = [{ id: 1, received_at: '2026-10-01T08:00:00', scan_sj_file: 'f' }];
		const arsip = new Map([['1', [{ lembar_nama: 'Putih', status: 'diarsip', wajib_kembali: true }]]]);
		const belum = new Map([['1', [{ lembar_nama: 'Putih', status: 'diserahkan', wajib_kembali: true }]]]);
		expect(computeTunggakanFisik(sj, arsip, rules, NOW).count).toBe(0);
		expect(computeTunggakanFisik(sj, belum, rules, NOW).count).toBe(1);
	});
	it('enforce_from mengecualikan SJ lama', () => {
		const r = normalizeTunggakanRules({ enforceFrom: '2026-10-05' });
		expect(computeTunggakanFisik([{ id: 1, received_at: '2026-10-01T08:00:00' }], new Map(), r, NOW).count).toBe(0);
	});
});
