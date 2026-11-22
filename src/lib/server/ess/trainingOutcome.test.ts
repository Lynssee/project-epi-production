import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn() }));
vi.mock('$lib/server/ess/teamTraining', () => ({ loadMentorConfig: vi.fn(), resolveTeamMembers: vi.fn() }));

import { hitungCapaian, normalisasiReviewTim, OutcomeError } from './trainingOutcome';

describe('hitungCapaian', () => {
	const o = [{ id: 1, tipe: 'ekspektasi', bobot: 2, wajib_tercapai: true }, { id: 2, tipe: 'ekspektasi', bobot: 1 }, { id: 3, tipe: 'output' }];
	it('tertimbang, abaikan non-ekspektasi, hitung wajib belum', () => {
		expect(hitungCapaian(o, [{ outcome_id: 1, status: 'tercapai' }, { outcome_id: 2, status: 'sebagian' }])).toEqual({ persen: 83, wajibBelum: 0 });
		expect(hitungCapaian(o, [{ outcome_id: 1, status: 'sebagian' }]).wajibBelum).toBe(1);
		expect(hitungCapaian(null as any, null as any)).toEqual({ persen: 0, wajibBelum: 0 });
	});
});

describe('normalisasiReviewTim', () => {
	it('draft kosong boleh; final kosong ditolak', () => {
		expect(normalisasiReviewTim({ memberId: 1, enrollmentId: 1 }).status).toBe('draft');
		expect(() => normalisasiReviewTim({ memberId: 1, enrollmentId: 1, status: 'final' })).toThrow(OutcomeError);
	});
	it('gap: buang kosong, batasi 5, default severity & tindak lanjut', () => {
		const r = normalisasiReviewTim({ memberId: 1, enrollmentId: 1, kekuatan: 'ok', tindakLanjut: 'x', gaps: [{ deskripsi: ' ' }, ...Array.from({ length: 7 }, (_, i) => ({ deskripsi: `g${i}`, severity: 'zzz', kategori_id: 3 }))] });
		expect(r.gaps).toHaveLength(5);
		expect(r.gaps[0]).toEqual({ kategori_id: 3, deskripsi: 'g0', severity: 'sedang' });
		expect(r.tindak_lanjut).toBe('none');
	});
});
