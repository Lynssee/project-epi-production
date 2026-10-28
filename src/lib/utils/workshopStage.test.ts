// Paritas dengan erp-epi `src/lib/utils/workshopStage.test.js` (WSK-31): kasus kunci yang HARUS sama di kedua repo.
import { describe, it, expect } from 'vitest';
import { deriveWorkshopStage, WORKSHOP_STAGE_KEYS, WORKSHOP_STAGES } from './workshopStage';

describe('deriveWorkshopStage (salinan erp-epi)', () => {
	it('7 tahap, urutan & kunci sama dengan dashboard admin', () => {
		expect([...WORKSHOP_STAGE_KEYS]).toEqual(['order', 'inbound', 'produksi', 'qc', 'siap_kirim', 'dikirim', 'tagih']);
		expect(WORKSHOP_STAGES.map((s) => s.label)).toEqual(['Order masuk', 'Barang customer diterima', 'Blasting & coating', 'QC / inspeksi', 'Siap kirim', 'Diserahkan ke customer', 'Ditagih / lunas']);
	});
	it('tanpa sinyal => order', () => {
		expect(deriveWorkshopStage({}).key).toBe('order');
	});
	it('SJ Masuk customer => inbound; laporan produksi tanpa SJ Masuk tetap minimal inbound (anti-lockdown)', () => {
		expect(deriveWorkshopStage({ hasCustomerSjMasuk: true }).key).toBe('inbound');
		expect(deriveWorkshopStage({ hasProduksiReport: true }).key).toBe('inbound');
	});
	it('progres / sandblasting > 0 => produksi', () => {
		expect(deriveWorkshopStage({ hasCustomerSjMasuk: true, progressPct: 30 }).key).toBe('produksi');
		expect(deriveWorkshopStage({ sandblastingSum: 5 }).key).toBe('produksi');
	});
	it('produksi selesai => qc; qcRequired=false melompat ke siap_kirim; inspeksi approved => siap_kirim', () => {
		expect(deriveWorkshopStage({ progressPct: 100 }).key).toBe('qc');
		expect(deriveWorkshopStage({ progressPct: 100, qcRequired: false }).key).toBe('siap_kirim');
		expect(deriveWorkshopStage({ hasInspeksiApproved: true }).key).toBe('siap_kirim');
	});
	it('SJ Keluar dibuat tapi belum semua diserahkan => siap_kirim (+partialDelivery); semua diserahkan => dikirim; + invoice resmi => tagih', () => {
		const sebagian = deriveWorkshopStage({ sjKeluarCount: 2, sjKeluarDeliveredCount: 1 });
		expect(sebagian.key).toBe('siap_kirim');
		expect(sebagian.partialDelivery).toBe(true);
		expect(deriveWorkshopStage({ sjKeluarCount: 2, sjKeluarDeliveredCount: 2 }).key).toBe('dikirim');
		expect(deriveWorkshopStage({ sjKeluarCount: 2, sjKeluarDeliveredCount: 2, hasOfficialInvoice: true }).key).toBe('tagih');
	});
	it('indeks mengikuti urutan tahap', () => {
		expect(deriveWorkshopStage({ sjKeluarCount: 1, sjKeluarDeliveredCount: 1, hasOfficialInvoice: true }).index).toBe(6);
	});
});
