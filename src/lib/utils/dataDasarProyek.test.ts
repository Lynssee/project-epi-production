import { describe, it, expect } from 'vitest';
import { missingDataDasar, DATA_DASAR_EVALUATORS, DEFAULT_GATE_EXTRA_ITEMS } from './dataDasarProyek';

// Kontrak: kasus-kasus ini identik dengan erp-epi/src/lib/data/projectDataDasar.test.js.
describe('missingDataDasar (kembar erp-epi)', () => {
	it('proyek kosong → semua item kurang', () => {
		expect(missingDataDasar({ lokasi: '  ', jenis_project: '', end_date: null, timeline_planning: null }, DEFAULT_GATE_EXTRA_ITEMS)).toEqual(DEFAULT_GATE_EXTRA_ITEMS);
	});
	it('lengkap (thumbnail objek atau string JSON) → tidak ada yang kurang', () => {
		const base = { jenis_project: 'coating', end_date: '2026-12-01', lokasi: 'Cilegon' };
		expect(missingDataDasar({ ...base, timeline_planning: { metadata: { thumbnail_file_id: 'f' } } }, DEFAULT_GATE_EXTRA_ITEMS)).toEqual([]);
		expect(missingDataDasar({ ...base, timeline_planning: '{"metadata":{"thumbnail_file_id":"f"}}' }, DEFAULT_GATE_EXTRA_ITEMS)).toEqual([]);
	});
	it('JSON rusak / null aman', () => {
		expect(DATA_DASAR_EVALUATORS.foto_proyek_set({ timeline_planning: '{bukan json' })).toBe(false);
		expect(missingDataDasar(null, DEFAULT_GATE_EXTRA_ITEMS)).toEqual(DEFAULT_GATE_EXTRA_ITEMS);
	});
	it('id di luar peta & input bukan array diabaikan', () => {
		expect(missingDataDasar({}, ['k3_docs'])).toEqual([]);
		expect(missingDataDasar({}, null)).toEqual([]);
	});
});
