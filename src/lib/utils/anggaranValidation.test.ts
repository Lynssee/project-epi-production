import { describe, it, expect } from 'vitest';
import { collectErrors, hasBlockingError, type ValidationInput } from './anggaranValidation';

const base = (): ValidationInput => ({
	tujuanPengajuan: 'Biaya operasional', atasNama: false, atasNamaPemohonId: null, atasNamaAlasan: '',
	penerimaDanaNama: 'PT X', paymentMethod: 'Cash', bankName: '', bankAccountNumber: '', bankAccountName: '',
	items: [{ name: 'Semen', price: 1000, kategori_item: 'supplier' }], mixedRowCount: 0,
	categoriesLoaded: true, selectedCategoryKode: 'operasional', categoryFields: [], dynamicValues: {},
	isPettyCashCategory: false, pettyCashFundId: null, projectRequired: false, selectedProject: '', projectRequiredLabel: 'Jasa',
	isRilisHutang: false, hasSelectedPayableInvoice: false, rilisNominal: 0, sisaHutang: 0,
	needsAttachment: false, hasLampiran: false, hasLampiranException: false, minExceptionNoteLength: 20, uploadingLampiran: false,
	bbmSplitEnabled: false, bbmSplits: [], formatCurrency: (n) => `Rp${n}`
});
const fields = (v: ValidationInput) => collectErrors(v).map((e) => e.field);

describe('collectErrors (PRJ-25)', () => {
	it('form valid -> tanpa kesalahan', () => expect(collectErrors(base())).toEqual([]));

	it('form kosong -> SEMUA kesalahan muncul sekaligus (bukan satu per satu)', () => {
		const v = { ...base(), tujuanPengajuan: '', penerimaDanaNama: '', paymentMethod: 'Transfer', items: [{ name: '', price: 0, kategori_item: '' }], selectedCategoryKode: '' };
		expect(fields(v)).toEqual(['tujuan', 'penerima', 'rekening', 'items', 'kategori']);
	});

	it('aturan item: nama berupa angka/nominal, harga 0, kategori kosong', () => {
		const v = { ...base(), items: [{ name: '150.000', price: 5, kategori_item: 'jasa' }, { name: 'Pasir', price: 0, kategori_item: '' }] };
		const f = fields(v);
		expect(f).toContain('item_0_nama');
		expect(f).toContain('item_1_harga');
		expect(f).toContain('item_kategori');
		expect(collectErrors(v).find((e) => e.field === 'item_1_harga')!.anchorId).toBe('f-item-1');
	});

	it('item campuran hanya PERINGATAN (tidak menahan)', () => {
		const issues = collectErrors({ ...base(), mixedRowCount: 2 });
		expect(issues).toHaveLength(1);
		expect(issues[0].severity).toBe('warning');
		expect(hasBlockingError(issues)).toBe(false);
	});

	it('atas nama, kas kecil, proyek wajib, field dinamis wajib', () => {
		const v = {
			...base(), atasNama: true, atasNamaAlasan: 'pendek', isPettyCashCategory: true, projectRequired: true,
			categoryFields: [{ field_key: 'so', field_label: 'SO Terkait', field_type: 'select_relation', is_required: true }, { field_key: 'opt', field_label: 'Opsional', field_type: 'text' }],
			dynamicValues: {}
		};
		expect(fields(v)).toEqual(['atas_nama', 'dyn_so', 'pc_fund', 'proyek']);
	});

	it('rilis hutang: nominal melebihi sisa; lampiran/pengecualian; upload; split BBM', () => {
		const v = { ...base(), isRilisHutang: true, hasSelectedPayableInvoice: true, rilisNominal: 500, sisaHutang: 100, needsAttachment: true, uploadingLampiran: true, bbmSplitEnabled: true, bbmSplits: [{ project_id: 1, persentase: 60 }, { project_id: 2, persentase: 30 }] };
		expect(fields(v)).toEqual(['rilis_nominal', 'lampiran', 'upload', 'bbm_split']);
		expect(collectErrors({ ...v, needsAttachment: true, hasLampiranException: true, uploadingLampiran: false, bbmSplits: [{ project_id: 1, persentase: 50 }, { project_id: 2, persentase: 50 }], rilisNominal: 50 })).toEqual([]);
	});
});
