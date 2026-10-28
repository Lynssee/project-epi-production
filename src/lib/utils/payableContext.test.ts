import { describe, it, expect } from 'vitest';
import { deriveBarangStatus, summarizeItemNames, paymentStageLabel, shouldOfferExpedite } from './payableContext';

describe('deriveBarangStatus', () => {
	it('kosong -> tidak_diketahui', () => {
		expect(deriveBarangStatus([])).toBe('tidak_diketahui');
		expect(deriveBarangStatus(null)).toBe('tidak_diketahui');
	});
	it('semua diterima / sebagian / belum', () => {
		expect(deriveBarangStatus([{ quantity: 5, received_qty: 5 }])).toBe('diterima');
		expect(deriveBarangStatus([{ quantity: 5, received_qty: 5 }, { quantity: 2, received_qty: 0 }])).toBe('sebagian');
		expect(deriveBarangStatus([{ quantity: 5, received_qty: null }])).toBe('belum');
	});
});

describe('summarizeItemNames', () => {
	it('memotong dan menghitung sisa', () => {
		const items = ['A', 'B', 'C', 'D', 'E'].map((item_name) => ({ item_name }));
		expect(summarizeItemNames(items)).toBe('A, B, C +2 lainnya');
		expect(summarizeItemNames([])).toBe('');
	});
});

describe('paymentStageLabel & shouldOfferExpedite', () => {
	it('prioritas label', () => {
		expect(paymentStageLabel({ scheduled_payment_date: '2026-10-09' })).toMatch(/^Dijadwalkan bayar/);
		expect(paymentStageLabel({ payment_urgency: 'urgent' })).toBe('Ditandai mendesak oleh Finance');
		expect(paymentStageLabel({})).toBe('Menunggu alokasi kas Finance');
	});
	it('percepatan hanya bila barang belum lengkap', () => {
		expect(shouldOfferExpedite('belum')).toBe(true);
		expect(shouldOfferExpedite('sebagian')).toBe(true);
		expect(shouldOfferExpedite('diterima')).toBe(false);
		expect(shouldOfferExpedite('tidak_diketahui')).toBe(false);
	});
});
