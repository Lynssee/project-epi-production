import { describe, it, expect } from 'vitest';
import { buildFillEmptyPatch, normalizeForm, validateNewSurvey, isBlank } from './leaderSurveyLogic';

describe('leaderSurveyLogic', () => {
	it('isBlank: 0 bukan kosong, spasi kosong', () => {
		expect(isBlank(0)).toBe(false);
		expect(isBlank('  ')).toBe(true);
		expect(isBlank(null)).toBe(true);
	});

	it('normalizeForm: trim, kosong->null, luas koma desimal, luas <=0 -> null', () => {
		const n = normalizeForm({ lokasi_project: '  Gresik ', luas_area: '12,5', catatan_khusus: '  ' });
		expect(n.lokasi_project).toBe('Gresik');
		expect(n.luas_area).toBe(12.5);
		expect(n.catatan_khusus).toBeNull();
		expect(normalizeForm({ luas_area: -3 }).luas_area).toBeNull();
		expect(normalizeForm({ luas_area: 'abc' }).luas_area).toBeNull();
	});

	it('buildFillEmptyPatch: hanya isi field kosong, catat yang dilewati', () => {
		const existing = { lokasi_project: 'Site A', luas_area: null, pic_lapangan: '', akses_lokasi: 'Gerbang 2' };
		const { patch, skipped } = buildFillEmptyPatch(existing, {
			lokasi_project: 'Site B',
			luas_area: 100,
			pic_lapangan: 'Budi',
			akses_lokasi: 'Gerbang 2'
		});
		expect(patch).toEqual({ luas_area: 100, pic_lapangan: 'Budi' });
		expect(skipped).toEqual(['lokasi_project']);
	});

	it('buildFillEmptyPatch: form kosong -> patch kosong', () => {
		expect(buildFillEmptyPatch({}, {}).patch).toEqual({});
	});

	it('validateNewSurvey', () => {
		expect(validateNewSurvey({})).toMatch(/Lokasi/);
		expect(validateNewSurvey({ lokasi_project: 'X', tanggal_mulai_target: '2026-10-10', tanggal_selesai_target: '2026-10-01' })).toMatch(/sebelum/);
		expect(validateNewSurvey({ lokasi_project: 'X' })).toBeNull();
	});
});
