import { describe, it, expect, vi, beforeEach } from 'vitest';

const directus = vi.fn();
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: unknown[]) => directus(...a) }));

import { getGerbangAntrian, alasanBelumSiap } from './sjGerbangAntrian';

beforeEach(() => directus.mockReset());

describe('sjGerbangAntrian (SJH-10)', () => {
	it('alasanBelumSiap: print_count 0 → "Belum dicetak"', () => {
		expect(alasanBelumSiap({ print_count: 0 })).toBe('Belum dicetak');
		expect(alasanBelumSiap({ print_count: 1 })).toBeNull();
	});
	it('memisahkan siap vs belum siap, melengkapi plat & item, dan membuang yang sudah lolos', async () => {
		directus
			.mockResolvedValueOnce({ data: [
				{ id: 1, nomor_sj: 'SJ/1', status: 'needs_security_check', print_count: 1, vehicle_id: 7, driver: 'A', date_created: new Date().toISOString() },
				{ id: 2, nomor_sj: 'SJ/2', status: 'needs_security_check', print_count: 0, vehicle_id: null, date_created: new Date().toISOString() },
				{ id: 3, nomor_sj: 'SJ/3', status: 'needs_security_check', print_count: 1, security_verified_at: '2026-10-01', date_created: new Date().toISOString() }
			] })
			.mockResolvedValueOnce({ data: [{ id: 7, nomor_polisi: 'B 1234 XY' }] })
			.mockResolvedValueOnce({ data: [{ surat_jalan_id: 1, nama_barang: 'Cat', qty_delivered: 4, unit: 'pail' }] });
		const r = await getGerbangAntrian();
		expect(r.siap.map((x) => x.id)).toEqual([1]);
		expect(r.siap[0].plat).toBe('B 1234 XY');
		expect(r.siap[0].items[0].nama_barang).toBe('Cat');
		expect(r.belumSiap.map((x) => x.id)).toEqual([2]);
		expect(r.belumSiap[0].belum_siap).toBe('Belum dicetak');
	});
});
