import { describe, it, expect } from 'vitest';
import { detectSumberKey, mergeSumberConfig, sumberOfProgram, DEFAULT_SUMBER } from './trainingSource';

describe('trainingSource (lapangan)', () => {
	it('deteksi dari kode, tag deskripsi, dan penanda pembuat', () => {
		expect(detectSumberKey({ kode: 'TRN-INV-P12' })).toBe('inv360_item');
		expect(detectSumberKey({ kode: 'TRN-INV-T3' })).toBe('inv360_item');
		expect(detectSumberKey({ kode: 'TRN-SOP-9' })).toBe('sop_doc');
		expect(detectSumberKey({ kode: 'TRN-NCR-4' })).toBe('ncr_case');
		expect(detectSumberKey({ kode: 'KC-P1', deskripsi: 'x [Sumber: ext_standard]' })).toBe('ext_standard');
		expect(detectSumberKey({ kode: 'AI-PRODUCT', created_by: 'ai-ingest' })).toBe('ext_gdrive');
		expect(detectSumberKey({ kode: 'KC-P1' })).toBe('manual_hrd');
		expect(detectSumberKey(null)).toBe('manual_hrd');
	});
	it('override admin: label/ikon; JSON rusak = default', () => {
		const cfg = mergeSumberConfig({ sop_doc: { label: 'SOP Kita', icon: '📘' }, asing: { label: 'x' } });
		expect(sumberOfProgram({ kode: 'TRN-SOP-1' }, cfg)).toEqual({ key: 'sop_doc', label: 'SOP Kita', icon: '📘' });
		expect(mergeSumberConfig('{rusak')).toEqual(DEFAULT_SUMBER);
	});
});
