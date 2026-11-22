import { describe, it, expect } from 'vitest';
import { buildLearningPath, summarizeLearningPath } from './learningPath';

describe('learningPath', () => {
	it('prasyarat lebih dulu & langkah berikutnya terkunci', () => {
		const steps = buildLearningPath([
			{ id: 2, namaSilabus: 'Inter', level: 'Intermediate', prerequisiteId: 1, progressPersen: 0 },
			{ id: 1, namaSilabus: 'Basic', level: 'Basic', progressPersen: 40 }
		]);
		expect(steps.map((s) => s.id)).toEqual([1, 2]);
		expect(steps.map((s) => s.status)).toEqual(['berjalan', 'terkunci']);
		expect(steps[1].prasyaratNama).toBe('Basic');
	});
	it('prasyarat selesai → terbuka; di luar daftar tidak mengunci; siklus aman; sentinel -1 diabaikan', () => {
		expect(
			buildLearningPath([
				{ id: 1, namaSilabus: 'a', progressPersen: 100 },
				{ id: 2, namaSilabus: 'b', prerequisiteId: 1, progressPersen: 0 }
			]).map((s) => s.status)
		).toEqual(['selesai', 'terbuka']);
		expect(buildLearningPath([{ id: 5, namaSilabus: 'x', prerequisiteId: 99, progressPersen: 0 }])[0].status).toBe('terbuka');
		expect(
			buildLearningPath([
				{ id: 1, namaSilabus: 'a', prerequisiteId: 2, progressPersen: 0 },
				{ id: 2, namaSilabus: 'b', prerequisiteId: 1, progressPersen: 0 }
			])
		).toHaveLength(2);
		expect(buildLearningPath([{ id: -1, namaSilabus: 'Onboarding', progressPersen: 0 }])).toEqual([]);
	});
	it('ringkasan', () => {
		const s = summarizeLearningPath(
			buildLearningPath([
				{ id: 1, namaSilabus: 'a', progressPersen: 100 },
				{ id: 2, namaSilabus: 'b', prerequisiteId: 1, progressPersen: 0 }
			])
		);
		expect(s).toMatchObject({ total: 2, selesai: 1, persen: 50 });
		expect(s.next?.id).toBe(2);
		expect(summarizeLearningPath([])).toEqual({ total: 0, selesai: 0, persen: 0, next: null });
	});
});

import { findNextMateri, estimasiSisaMenit } from './learningPath';
describe('findNextMateri & estimasiSisaMenit', () => {
	const m = (o: any) => ({ programId: 1, programJudul: 'P', status: 'Belum Terdaftar', progressPersen: 0, locked: false, isWajib: true, urutan: 0, ...o });
	it('utamakan yang berjalan; lewati terkunci & lulus', () => {
		const r = findNextMateri([m({ programId: 1, status: 'Lulus' }), m({ programId: 2, locked: true }), m({ programId: 3 }), m({ programId: 4, status: 'Ongoing', progressPersen: 40 })]);
		expect(r?.programId).toBe(4);
	});
	it('wajib sebelum opsional; semua selesai → null', () => {
		expect(findNextMateri([m({ programId: 1, isWajib: false }), m({ programId: 2 })])?.programId).toBe(2);
		expect(findNextMateri([m({ status: 'Lulus' })])).toBeNull();
		expect(findNextMateri(null)).toBeNull();
	});
	it('estimasi sisa menit', () => {
		expect(estimasiSisaMenit(60, 50)).toBe(30);
		expect(estimasiSisaMenit(60, 100)).toBe(1);
		expect(estimasiSisaMenit(null, 10)).toBeNull();
	});
});
