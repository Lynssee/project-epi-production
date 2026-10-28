import { describe, it, expect } from 'vitest';
import { matchDuplicateOutflows, type OutflowCandidate } from './outflowDuplicate';

const c = (o: Partial<OutflowCandidate>): OutflowCandidate => ({ id: 1, source: 'pengajuan_anggaran', date: '2026-10-05', amount: 500000, label: 'PA', ...o });

describe('matchDuplicateOutflows (PRJ-29)', () => {
	it('nominal sama & tanggal dalam 7 hari => cocok', () => {
		expect(matchDuplicateOutflows([c({})], 500000, '2026-10-08')).toHaveLength(1);
	});
	it('nominal beda / di luar jendela / tanggal rusak => tidak cocok', () => {
		expect(matchDuplicateOutflows([c({ amount: 500001.5 })], 500000, '2026-10-08')).toHaveLength(0);
		expect(matchDuplicateOutflows([c({ date: '2026-09-20' })], 500000, '2026-10-08')).toHaveLength(0);
		expect(matchDuplicateOutflows([c({ date: null })], 500000, '2026-10-08')).toHaveLength(0);
		expect(matchDuplicateOutflows([c({})], 500000, 'bukan-tanggal')).toHaveLength(0);
	});
	it('nominal nol / kosong => tidak mengecek', () => {
		expect(matchDuplicateOutflows([c({ amount: 0 })], 0, '2026-10-08')).toHaveLength(0);
		expect(matchDuplicateOutflows([], 500000, '2026-10-08')).toHaveLength(0);
	});
});
