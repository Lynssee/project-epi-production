import { describe, it, expect, vi, beforeEach } from 'vitest';

let responses: Record<string, () => any> = {};
const urls: string[] = [];

vi.mock('$lib/server/goodsReceived/guard', () => ({
	authenticateGRActor: vi.fn(async () => ({ karyawan: { id: 1 }, projectIds: [7], role: 'project_leader' }))
}));
vi.mock('$lib/server/sjManualFields', () => ({ toLegacyHeader: vi.fn(() => ({ manual_customer_name: null })) }));
vi.mock('$lib/server/directus', () => ({
	directusServerJson: vi.fn(async (url: string) => {
		urls.push(url);
		const name = (url.match(/\/items\/([a-z_]+)/) || [])[1];
		const fn = responses[name];
		if (!fn) throw new Error(`tak ada respons untuk ${name}`);
		return fn();
	})
}));

import { GET } from './+server';

const ok = (rows: any = []) => () => ({ data: rows });
const fail = (m: string) => () => {
	throw new Error(m);
};

beforeEach(() => {
	urls.length = 0;
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	responses = {
		project_expenses: ok([{ id: 1, project_id: 7, surat_jalan_id: 970, material_name: 'Cat', unit: 'kg', unit_price: 100, qty_sent: 5, expense_type: 'material', identitas_barang_id: null }]),
		surat_jalan: ok([{ id: 970, nomor_sj: '0023/EPI', driver: 'PANJI', date_created: '2026-11-04T01:00:00Z', qr_token: null, status: 'shipped', vehicle_id: 1, mode_kirim: 'driver_internal', eta_tiba: null, no_resi: null }]),
		projects: ok([{ id: 7, name: 'Proyek X' }]),
		surat_jalan_items: ok([]),
		fleet_kendaraan: ok([{ id: 1, nomor_polisi: 'B 1234 XY' }])
	};
});

describe('GET goods-received/list — info perjalanan (Fase 6)', () => {
	it('menambahkan plat truk (query terpisah), mode kirim, ETA, resi', async () => {
		const { shipments } = await (await GET({} as any)).json();
		expect(shipments).toHaveLength(1);
		expect(shipments[0]).toMatchObject({ suratJalanId: 970, driver: 'PANJI', plat: 'B 1234 XY', modeKirim: 'driver_internal', etaTiba: null, noResi: null });
		expect(urls.filter((u) => u.includes('/items/fleet_kendaraan'))).toHaveLength(1);
		expect(urls.some((u) => u.includes('/items/surat_jalan?') && u.includes('vehicle_id') && u.includes('eta_tiba'))).toBe(true);
	});
	it('gagal baca kendaraan -> daftar GR tetap tampil, plat null', async () => {
		responses.fleet_kendaraan = fail('boom');
		const { shipments } = await (await GET({} as any)).json();
		expect(shipments).toHaveLength(1);
		expect(shipments[0].plat).toBeNull();
	});
	it('tanpa vehicle_id -> tidak query kendaraan sama sekali (hemat API)', async () => {
		responses.surat_jalan = ok([{ id: 970, nomor_sj: '0023/EPI', driver: 'PANJI', date_created: '2026-11-04T01:00:00Z', qr_token: null, status: 'shipped', vehicle_id: null }]);
		const { shipments } = await (await GET({} as any)).json();
		expect(shipments[0].plat).toBeNull();
		expect(urls.some((u) => u.includes('/items/fleet_kendaraan'))).toBe(false);
	});
});
