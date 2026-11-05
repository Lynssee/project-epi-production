import { describe, it, expect } from 'vitest';
import { buildDropshipOrders } from './dropshipOrders';

const projectNameById = new Map([[972, 'PT. FUCHS INDONESIA']]);
const prs = [{ id: 2317, project_id: 972 }, { id: 2400, project_id: { id: 979 } }];

describe('buildDropshipOrders', () => {
	it('PO terkirim yang masih punya sisa barang tampil dengan ETA, proyek, dan sisa qty', () => {
		const r = buildDropshipOrders({
			prs,
			pos: [{ id: 932, po_number: 'POS-2611-0003', pengajuan_id: 2317, status: 'sent', supplier_name: 'Umar Bakri Ahmad', delivery_date: '2026-11-05T00:00:00' }],
			items: [
				{ po_id: 932, item_name: 'SEMEN PUTIH', quantity: 4, received_qty: 1, unit: 'sack' },
				{ po_id: 932, item_name: 'EMBER', quantity: '1', received_qty: 0, unit: 'pcs' }
			],
			projectNameById
		});
		expect(r).toHaveLength(1);
		expect(r[0]).toMatchObject({ poNumber: 'POS-2611-0003', projectName: 'PT. FUCHS INDONESIA', eta: '2026-11-05', sisaQty: 4 });
		expect(r[0].items[0]).toEqual({ name: 'SEMEN PUTIH', qty: 4, received: 1, unit: 'sack' });
	});

	it('PO draft, sudah diterima penuh, atau tanpa proyek tidak tampil', () => {
		const r = buildDropshipOrders({
			prs,
			pos: [
				{ id: 1, pengajuan_id: 2317, status: 'draft' },
				{ id: 2, pengajuan_id: 2317, status: 'received' },
				{ id: 3, pengajuan_id: 2317, status: 'sent' },
				{ id: 4, pengajuan_id: 9999, status: 'sent' }
			],
			items: [
				{ po_id: 1, quantity: 1, received_qty: 0 },
				{ po_id: 2, quantity: 1, received_qty: 1 },
				{ po_id: 3, quantity: 2, received_qty: 2 },
				{ po_id: 4, quantity: 1, received_qty: 0 }
			],
			projectNameById
		});
		expect(r).toEqual([]);
	});

	it('urut ETA terdekat; tanpa ETA di akhir; nama proyek fallback bila tak dikenal', () => {
		const r = buildDropshipOrders({
			prs,
			pos: [
				{ id: 10, pengajuan_id: 2317, status: 'sent', delivery_date: null },
				{ id: 11, pengajuan_id: 2400, status: 'partial_received', delivery_date: '2026-11-03' },
				{ id: 12, pengajuan_id: 2317, status: 'sent', delivery_date: '2026-11-01' }
			],
			items: [{ po_id: 10, quantity: 1 }, { po_id: 11, quantity: 1 }, { po_id: 12, quantity: 1 }],
			projectNameById
		});
		expect(r.map((o) => o.poId)).toEqual([12, 11, 10]);
		expect(r[1].projectName).toBe('Proyek #979');
	});

	it('input kosong aman', () => {
		expect(buildDropshipOrders({ prs: [], pos: [], items: [], projectNameById: new Map() })).toEqual([]);
	});
});
