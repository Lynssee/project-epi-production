// EPI Academy Fase 5 — POST /api/ess/training/quiz/[quizId]: kuis akhir pada enrollment Lulus → 409.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockJson = vi.fn();
vi.mock('$lib/server/directus', () => ({
	directusServerJson: (...a: unknown[]) => mockJson(...a),
	directusServerUpload: vi.fn()
}));
vi.mock('$lib/server/ess/attendanceGuard', () => ({
	authenticateEss: vi.fn().mockResolvedValue({ karyawan: { id: 5 } })
}));
vi.mock('$lib/server/ess/sop', () => ({ findSopByProgramId: vi.fn().mockResolvedValue(null) }));
vi.mock('$lib/server/ess/trainingCertificate', () => ({ issueCertificate: vi.fn() }));
vi.mock('$lib/server/ess/trainingSkill', () => ({ deriveSkillsFromEnrollment: vi.fn() }));

const { POST, GET } = await import('../../../routes/api/ess/training/quiz/[quizId]/+server');

let writes: string[] = [];
let enrollmentStatus = 'Lulus';
let quiz: any;

beforeEach(() => {
	writes = [];
	enrollmentStatus = 'Lulus';
	quiz = { id: 100, program_id: 9, module_id: null, judul: 'Ujian Akhir', passing_score: 70, acak_soal: false };
	mockJson.mockReset();
	mockJson.mockImplementation((rawUrl: string, init?: { method?: string }) => {
		const url = decodeURIComponent(rawUrl);
		if (init?.method && init.method !== 'GET') {
			writes.push(`${init.method} ${url}`);
			return Promise.resolve({ data: { id: 1 } });
		}
		if (url.startsWith('/items/training_quiz/')) return Promise.resolve({ data: quiz });
		if (url.startsWith('/items/training_enrollment?')) return Promise.resolve({ data: [{ id: 1, program_id: 9, karyawan_id: 5, status: enrollmentStatus }] });
		if (url.startsWith('/items/training_enrollment/')) return Promise.resolve({ data: { id: 1, program_id: 9, karyawan_id: 5, status: enrollmentStatus } });
		if (url.includes('training_quiz_question')) return Promise.resolve({ data: [{ id: 1, quiz_id: 100, tipe: 'pilihan_ganda', bobot: 1, jawaban_benar: 'x' }] });
		if (url.includes('training_quiz_attempt')) return Promise.resolve({ data: [] });
		if (url.includes('training_settings')) return Promise.resolve({ data: { max_quiz_attempts: 3 } });
		if (url.includes('training_module')) return Promise.resolve({ data: [] });
		if (url.includes('training_progress')) return Promise.resolve({ data: [] });
		return Promise.resolve({ data: [] });
	});
});

const post = (jawaban: unknown[]) =>
	POST({
		params: { quizId: '100' },
		request: new Request('http://x/api', { method: 'POST', body: JSON.stringify({ jawaban }) })
	} as any);

const statusOf = async (p: PromiseLike<unknown> | unknown) => {
	try {
		await p;
		return 'ok';
	} catch (e: any) {
		return e?.status ?? 'error';
	}
};

describe('POST kuis', () => {
	it('kuis akhir + Lulus → 409 ramah, tanpa tulis apa pun', async () => {
		try {
			await post([{ question_id: 1, jawaban: 'y' }]);
			expect.unreachable();
		} catch (e: any) {
			expect(e.status).toBe(409);
			expect(String(e.body?.message)).toContain('sudah dinyatakan Lulus');
		}
		expect(writes).toHaveLength(0);
	});

	it('kuis formatif + Lulus → diproses normal', async () => {
		quiz.module_id = 50;
		expect(await statusOf(post([{ question_id: 1, jawaban: 'y' }]))).toBe('ok');
		expect(writes.some((w) => w.includes('training_quiz_attempt'))).toBe(true);
		expect(writes.some((w) => w.includes('training_enrollment'))).toBe(false);
	});

	it('kuis akhir + belum Lulus → diproses normal (gagal → Remedial)', async () => {
		enrollmentStatus = 'Ongoing';
		expect(await statusOf(post([{ question_id: 1, jawaban: 'y' }]))).toBe('ok');
		expect(writes.some((w) => w.startsWith('PATCH /items/training_enrollment/1'))).toBe(true);
	});
});

describe('GET kuis', () => {
	it('mengirim flag sudahLulus untuk kuis akhir pada enrollment Lulus', async () => {
		const res = await GET({ params: { quizId: '100' } } as any);
		expect((await res.json()).sudahLulus).toBe(true);
	});
});
