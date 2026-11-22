import { describe, it, expect } from 'vitest';
import { resolveMicroQuizSettings, normalizeQuestion, pickQuestion, shuffledOptions, toClientQuestion, gradeAnswer, daysBefore, hashSeed, hitungStreak, type PoolQuestion } from './microQuizModel';

const q = (id: number, extra: Partial<PoolQuestion> = {}): PoolQuestion => ({ id, program_id: 1, pertanyaan: `Q${id}`, tipe: 'pilihan_ganda', opsi: ['a', 'b', 'c', 'd'], jawaban_benar: 'b', ...extra });

describe('resolveMicroQuizSettings', () => {
	it('default bila kosong/undefined', () => {
		expect(resolveMicroQuizSettings(undefined)).toMatchObject({ enabled: true, kategori: ['HSE & K3'], programIds: [], hindariHari: 30 });
	});
	it('membaca nilai', () => {
		const s = resolveMicroQuizSettings([
			{ setting_key: 'micro_quiz.enabled', setting_value: 'false' },
			{ setting_key: 'micro_quiz.kategori', setting_value: 'HSE & K3, Technical' },
			{ setting_key: 'micro_quiz.program_ids', setting_value: '18, x, 144' },
			{ setting_key: 'micro_quiz.hindari_ulang_hari', setting_value: '9999' }
		]);
		expect(s).toEqual({ enabled: false, kategori: ['HSE & K3', 'Technical'], programIds: [18, 144], hindariHari: 365 });
	});
});

describe('normalizeQuestion', () => {
	it('menerima opsi array & string JSON', () => {
		expect(normalizeQuestion({ id: 1, pertanyaan: 'x', tipe: 'pilihan_ganda', opsi: ['a', 'b'], jawaban_benar: 'a' }, 9)?.program_id).toBe(9);
		expect(normalizeQuestion({ id: 1, pertanyaan: 'x', tipe: 'benar_salah', opsi: '["Benar","Salah"]', jawaban_benar: 'Benar' }, 9)).not.toBeNull();
	});
	it('menolak esai, kunci tidak ada di opsi, opsi rusak, data null', () => {
		expect(normalizeQuestion({ id: 1, pertanyaan: 'x', tipe: 'esai', opsi: ['a', 'b'], jawaban_benar: 'a' }, 1)).toBeNull();
		expect(normalizeQuestion({ id: 1, pertanyaan: 'x', tipe: 'pilihan_ganda', opsi: ['a', 'b'], jawaban_benar: 'z' }, 1)).toBeNull();
		expect(normalizeQuestion({ id: 1, pertanyaan: 'x', tipe: 'pilihan_ganda', opsi: '{rusak', jawaban_benar: 'a' }, 1)).toBeNull();
		expect(normalizeQuestion(null, 1)).toBeNull();
	});
});

describe('pickQuestion', () => {
	const pool = [q(1), q(2), q(3), q(4), q(5)];
	it('deterministik untuk seed sama, tidak peduli urutan pool', () => {
		const a = pickQuestion(pool, '7:2026-11-20');
		const b = pickQuestion([...pool].reverse(), '7:2026-11-20');
		expect(a?.id).toBe(b?.id);
	});
	it('pool kosong → null', () => {
		expect(pickQuestion([], 's')).toBeNull();
		expect(pickQuestion(undefined, 's')).toBeNull();
	});
	it('menghindari soal yang sudah pernah dijawab bila masih ada yang baru', () => {
		const seen = new Set([1, 2, 3, 4]);
		expect(pickQuestion(pool, 'apa-saja', seen)?.id).toBe(5);
	});
	it('semua sudah pernah dijawab → tetap mengembalikan soal (pool bergilir)', () => {
		expect(pickQuestion(pool, 's', new Set([1, 2, 3, 4, 5]))).not.toBeNull();
	});
	it('berganti antar hari (tidak selalu sama)', () => {
		const ids = new Set(Array.from({ length: 20 }, (_, i) => pickQuestion(pool, `7:2026-11-${10 + i}`)?.id));
		expect(ids.size).toBeGreaterThan(1);
	});
});

describe('opsi & penilaian', () => {
	it('shuffle deterministik dan berisi opsi yang sama', () => {
		const a = shuffledOptions(q(1), 's');
		expect(a).toEqual(shuffledOptions(q(1), 's'));
		expect([...a].sort()).toEqual(['a', 'b', 'c', 'd']);
	});
	it('benar/salah tidak diacak', () => {
		expect(shuffledOptions(q(1, { tipe: 'benar_salah', opsi: ['Benar', 'Salah'], jawaban_benar: 'Benar' }), 's')).toEqual(['Benar', 'Salah']);
	});
	it('klien tidak menerima kunci jawaban', () => {
		const c = toClientQuestion(q(1), 's') as any;
		expect(c.jawaban_benar).toBeUndefined();
		expect(Object.keys(c).sort()).toEqual(['id', 'opsi', 'pertanyaan', 'tipe']);
	});
	it('gradeAnswer toleran huruf besar/spasi; null aman', () => {
		expect(gradeAnswer(q(1), ' B ')).toBe(true);
		expect(gradeAnswer(q(1), 'a')).toBe(false);
		expect(gradeAnswer(null, 'b')).toBe(false);
		expect(gradeAnswer(q(1), undefined)).toBe(false);
	});
});

describe('util', () => {
	it('daysBefore', () => {
		expect(daysBefore('2026-03-02', 2)).toBe('2026-02-28');
		expect(daysBefore('2026-01-01', 0)).toBe('2026-01-01');
	});
	it('hashSeed stabil', () => expect(hashSeed('abc')).toBe(hashSeed('abc')));
});

describe('hitungStreak', () => {
	it('beruntun berakhir hari ini', () => expect(hitungStreak(['2026-11-17', '2026-11-18', '2026-11-19'], '2026-11-19')).toBe(3));
	it('belum menjawab hari ini → masih dihitung sampai kemarin', () => expect(hitungStreak(['2026-11-17', '2026-11-18'], '2026-11-19')).toBe(2));
	it('putus bila kemarin kosong dan hari ini kosong', () => expect(hitungStreak(['2026-11-16', '2026-11-17'], '2026-11-19')).toBe(0));
	it('lompat hari memutus; tanggal ganda/format panjang aman', () => expect(hitungStreak(['2026-11-19T00:00:00', '2026-11-19', '2026-11-17'], '2026-11-19')).toBe(1));
	it('kosong', () => expect(hitungStreak([], '2026-11-19')).toBe(0));
});
