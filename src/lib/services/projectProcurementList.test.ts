import { describe, it, expect } from 'vitest';
import { buildProjectProcurementList } from './procurementApi';

describe('buildProjectProcurementList', () => {
	it('menggabungkan PR, item, dan PO tertaut secara terpisah per relasi', () => {
		const prRows = [
			{
				id: 2273,
				nomor_pengajuan: 'PR-2273',
				status: 'Approved',
				nama_pengaju: 'Mekanik Lapangan',
				tujuan_pengajuan: 'Sewa Compressor untuk blasting',
				kategori_pembelian: 'sewa_alat',
				date_created: '2026-10-18T10:00:00Z',
				urgency: 'high',
				is_non_stock: true
			},
			{
				id: 2274,
				nomor_pengajuan: 'PR-2274',
				status: 'Approved',
				nama_pengaju: 'Mekanik Lapangan',
				tujuan_pengajuan: 'Press Selang & Servis Mesin',
				kategori_pembelian: 'consumable',
				date_created: '2026-10-18T11:00:00Z',
				urgency: 'medium',
				is_non_stock: true
			}
		];

		const prItems = [
			{ id: 1, request_id: 2273, nama_barang: 'Sewa Compressor 175 CFM', quantity: 1, units: 'unit', harga: 5000000 },
			{ id: 2, request_id: 2274, nama_barang: 'Press Selang Hidrolik', quantity: 1, units: 'pcs', harga: 120000 }
		];

		const poRows = [
			{ id: 857, po_number: 'POS-2610-0070', supplier_name: 'PT. TRI DAYA MAXIMA', status: 'draft', pengajuan_id: 2273 },
			{ id: 849, po_number: 'POS-2610-0062', supplier_name: 'PT. TRI DAYA MAXIMA', status: 'sent', pengajuan_id: 2274 }
		];

		const poItems = [
			{ id: 10, po_id: 857, item_name: 'Sewa Compressor 175 CFM', quantity: 1, unit_price: 5000000, received_qty: 0 },
			{ id: 11, po_id: 849, item_name: 'Press Selang Hidrolik', quantity: 1, unit_price: 120000, received_qty: 0 }
		];

		const result = buildProjectProcurementList({ prRows, prItems, poRows, poItems });

		expect(result).toHaveLength(2);

		const pr2273 = result.find((r) => r.id === 2273);
		expect(pr2273).toBeDefined();
		expect(pr2273?.total_amount).toBe(5000000);
		expect(pr2273?.status_label).toBe('PO Draft (POS-2610-0070)');
		expect(pr2273?.pos).toHaveLength(1);
		expect(pr2273?.pos[0].supplier_name).toBe('PT. TRI DAYA MAXIMA');

		const pr2274 = result.find((r) => r.id === 2274);
		expect(pr2274).toBeDefined();
		expect(pr2274?.total_amount).toBe(120000);
		expect(pr2274?.status_label).toBe('PO Terkirim (POS-2610-0062)');
		expect(pr2274?.pos[0].status).toBe('sent');
	});

	it('menghitung received_amount jika item PO sebagian sudah diterima', () => {
		const prRows = [
			{ id: 100, nomor_pengajuan: 'PR-100', status: 'Approved' }
		];
		const prItems = [
			{ id: 1, request_id: 100, nama_barang: 'Baut M16', quantity: 10, harga: 15000 }
		];
		const poRows = [
			{ id: 50, po_number: 'POS-50', supplier_name: 'Vendor Baut', status: 'partial_received', pengajuan_id: 100 }
		];
		const poItems = [
			{ id: 9, po_id: 50, item_name: 'Baut M16', quantity: 10, unit_price: 15000, received_qty: 4 }
		];

		const result = buildProjectProcurementList({ prRows, prItems, poRows, poItems });
		expect(result[0].total_amount).toBe(150000);
		expect(result[0].received_amount).toBe(60000); // 4 * 15.000
		expect(result[0].status_label).toBe('Diterima Sebagian (POS-50)');
	});
});
