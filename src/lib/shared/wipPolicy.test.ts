import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn() }));

import { wipBerlaku, bacaSetelan, susunKebijakanWip, debitBiayaProyek, AKUN_BIAYA_WIP_DEFAULT } from './wipPolicy';

const rows = (o: Record<string, unknown>) => Object.entries(o).map(([setting_key, setting_value]) => ({ setting_key, setting_value }));

describe('wipBerlaku — tidak retroaktif', () => {
	it('kosong → mati; sebelum → mati; pada/sesudah → berlaku', () => {
		expect(wipBerlaku('2026-12-10', '')).toBe(false);
		expect(wipBerlaku('2026-11-30', '2026-12-01')).toBe(false);
		expect(wipBerlaku('2026-12-01', '2026-12-01')).toBe(true);
		expect(wipBerlaku(null, '2026-12-01')).toBe(false);
	});
});

describe('bacaSetelan / susunKebijakanWip', () => {
	it('mengurai nilai JSON system_settings; bawaan bila kosong', () => {
		expect(bacaSetelan('"2026-12-01"', '')).toBe('2026-12-01');
		expect(bacaSetelan('["5100011"]', [])).toEqual(['5100011']);
		expect(bacaSetelan(null, 'x')).toBe('x');
		expect(bacaSetelan('bukan-json', 'x')).toBe('bukan-json');
	});
	it('setelan kosong → mati dengan akun & daftar bawaan', () => {
		const k = susunKebijakanWip('2026-12-10', []);
		expect(k).toEqual({ aktif: false, akun: '1132-001', akunBiaya: AKUN_BIAYA_WIP_DEFAULT });
	});
	it('setelan terisi → aktif, akun & daftar dari data', () => {
		const k = susunKebijakanWip('2026-12-10', rows({ 'finance.proyek.wip_sejak': '"2026-12-01"', 'finance.akun.wip_proyek': '"1132-002"', 'finance.proyek.akun_biaya_wip': '["5100011"]' }));
		expect(k).toEqual({ aktif: true, akun: '1132-002', akunBiaya: ['5100011'] });
	});
});

describe('debitBiayaProyek — paritas dengan erp-epi', () => {
	const wip = { aktif: true, akun: '1132-001', akunBiaya: ['5100001', '5100011'] };
	it('aktif + proyek + akun biaya proyek → WIP dengan jenis di prefix', () => {
		expect(debitBiayaProyek({ mappingDebit: '5100011', mappingDebitName: 'Upah', jenisLabel: 'jasa', projectId: 7, wip })).toMatchObject({ account_code: '1132-001', dialihkan: true, prefix: '[WIP 5100011 jasa] ' });
	});
	it('mati / tanpa proyek / akun bukan biaya proyek / sudah WIP → akun semula', () => {
		const base = { mappingDebit: '5100011', mappingDebitName: 'Upah', projectId: 7 as number | null, wip };
		expect(debitBiayaProyek({ ...base, wip: { ...wip, aktif: false } }).dialihkan).toBe(false);
		expect(debitBiayaProyek({ ...base, projectId: null }).dialihkan).toBe(false);
		expect(debitBiayaProyek({ ...base, mappingDebit: '6161-001' }).dialihkan).toBe(false);
		expect(debitBiayaProyek({ ...base, mappingDebit: '5110-001' }).account_code).toBe('5110-001');
		expect(debitBiayaProyek({ ...base, mappingDebit: '1132-001' }).dialihkan).toBe(false);
	});
});
