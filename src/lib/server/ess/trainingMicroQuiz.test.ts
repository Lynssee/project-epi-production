import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn() }));
vi.mock('$lib/server/ess/training', () => ({
	signQuizPayload: (d: string) => require('node:crypto').createHmac('sha256', 'k').update(d).digest('hex')
}));

import { gradeMicro, makeMicroToken, pickMicroQuestions, resolveMicroCount, verifyMicroToken } from './trainingMicroQuiz';

const Q = (id: number, extra: any = {}) => ({ id, pertanyaan: `Soal ${id}`, tipe: 'pilihan_ganda', opsi: ['A', 'B'], jawaban_benar: 'B', ...extra });

describe('resolveMicroCount', () => {
	it('default 3, 0 = nonaktif, maks 5, rusak → default', () => {
		expect(resolveMicroCount(undefined)).toBe(3);
		expect(resolveMicroCount(0)).toBe(0);
		expect(resolveMicroCount(9)).toBe(5);
		expect(resolveMicroCount('x')).toBe(3);
	});
});

describe('pickMicroQuestions', () => {
	it('membuang soal cacat & membatasi jumlah', () => {
		const all = [Q(1), Q(2), Q(3), Q(4), Q(5, { jawaban_benar: 'Z' }), Q(6, { tipe: 'esai' }), Q(7, { opsi: ['A'] })];
		const r = pickMicroQuestions(all, 3, () => 0.5);
		expect(r).toHaveLength(3);
		expect(r.every((q) => [1, 2, 3, 4].includes(q.id))).toBe(true);
	});
});

describe('token', () => {
	it('valid hanya untuk karyawan & program yang sama, dan sebelum kedaluwarsa', () => {
		const t = makeMicroToken(7, 12, [3, 1, 2], 1_000);
		expect(verifyMicroToken(t, 7, 12, 2_000)).toEqual([1, 2, 3]);
		expect(verifyMicroToken(t, 8, 12, 2_000)).toBeNull();
		expect(verifyMicroToken(t, 7, 13, 2_000)).toBeNull();
		expect(verifyMicroToken(t, 7, 12, 1_000 + 31 * 60_000)).toBeNull();
		expect(verifyMicroToken(t.slice(0, -2) + 'xx', 7, 12, 2_000)).toBeNull();
		expect(verifyMicroToken(null, 7, 12)).toBeNull();
	});
});

describe('gradeMicro', () => {
	it('case-insensitive, jawaban kosong salah, kunci dikembalikan sesuai ejaan opsi', () => {
		const served = [Q(1, { opsi: ['Benar', 'Salah'], jawaban_benar: 'benar' }), Q(2)];
		const r = gradeMicro(served as any, { '1': ' BENAR ', '2': '' });
		expect(r).toMatchObject({ benar: 1, total: 2 });
		expect(r.results[0]).toMatchObject({ benar: true, jawabanBenar: 'Benar' });
		expect(r.results[1]).toMatchObject({ benar: false, jawabanBenar: 'B' });
	});
});
